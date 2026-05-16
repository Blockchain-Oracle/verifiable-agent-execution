/**
 * Tests for packages/chain-client/src/SessionAnchor.ts.
 *
 * BDD acceptance from context/docs/stories/story-session-mint.md:
 *   - constructor(sessionLogger, agenticIdClient, agentId, modelId, options)
 *   - anchor({ sessionId, containerHash }) →
 *       1. flushes log → rootHash
 *       2. builds IntelligentData { dataDescription: "exec-log:<sessionId>:<modelId>",
 *                                   dataHash: rootHash }
 *       3. mints iNFT
 *       4. returns { tokenId, txHash, rootHash, entryCount, verifyUrl }
 *   - verifyUrl follows `/verify/<tokenId>` (network is implicit
 *     from the verifyUrlBase domain; subdomain-split model)
 *   - mint receipt contains an IntelligentDataSet event (covered transitively
 *     by AgenticIDClient — re-asserted here at the integration boundary)
 *
 * Strategy: stub SessionLogger and AgenticIDClient with minimal
 * test doubles so the orchestration logic is asserted without
 * standing up 0G Storage or a chain RPC. Live integration paths are
 * covered by the agenticid-client.test.ts gated suite + the
 * scripts/smoke/ harnesses.
 */

import {
  Interface,
  Wallet,
  type ContractTransactionResponse,
  type Log,
  type TransactionReceipt,
} from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  SessionLogger,
  StorageClient,
  type IndexerLike,
} from "@verifiable-agent-execution/logger";

import {
  AGENTICID_ABI,
  AgenticIDClient,
  type AgenticIDContractLike,
  type IntelligentData,
  type MintResult,
  SessionAnchor,
  SessionAnchorError,
  SessionAnchorMintAfterFlushError,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Constants — fixed test vectors so assertions can be exact.
// ---------------------------------------------------------------------------

const VALID_AGENT_ADDRESS = `0x${"a".repeat(40)}`;
const PRE_DEPLOYED_AGENTICID = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const ROOT_HASH = `0x${"f".repeat(64)}`;
const CONTAINER_HASH = `0x${"c".repeat(64)}`;
const MINT_TX_HASH = `0x${"d".repeat(64)}`;
const MINT_TOKEN_ID = 42n;
const MODEL_ID = "claude-sonnet-4-6";
const SESSION_ID = "ses_anchor_01";
const GALILEO_CHAIN_ID = 16602;

// ---------------------------------------------------------------------------
// Test double factories
// ---------------------------------------------------------------------------

/**
 * Build a real SessionLogger backed by a stubbed StorageClient so the
 * setMetadata + flush sequence runs end-to-end through actual code,
 * with the upload short-circuited to a deterministic rootHash.
 */
function buildSessionLogger(opts?: {
  uploadOverride?: IndexerLike["upload"];
  sessionId?: string;
}): SessionLogger {
  const indexer: IndexerLike = {
    upload:
      opts?.uploadOverride ??
      ((async () => [
        { rootHash: ROOT_HASH, txHash: `0x${"b".repeat(64)}`, txSeq: 0 },
        null,
      ]) as unknown as IndexerLike["upload"]),
    downloadToBlob: (async () => {
      throw new Error("downloadToBlob not configured for SessionAnchor tests");
    }) as unknown as IndexerLike["downloadToBlob"],
  };
  const storage = new StorageClient({
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    signer: new Wallet(`0x${"1".repeat(64)}`),
    indexer,
  });
  return new SessionLogger(opts?.sessionId ?? SESSION_ID, storage);
}

/**
 * AgenticIDContractLike stub. `mint` capture lets each test assert
 * what `to` and `datas` were forwarded by SessionAnchor.
 */
function buildAgenticIdContract(opts?: {
  mintOverride?: AgenticIDContractLike["iMint"];
}): {
  contract: AgenticIDContractLike;
  iMint: ReturnType<typeof vi.fn>;
} {
  const iMint = vi.fn(opts?.mintOverride as never);
  const contract: AgenticIDContractLike = {
    iMint: iMint as unknown as AgenticIDContractLike["iMint"],
    getIntelligentDatas: (async () => []) as unknown as AgenticIDContractLike["getIntelligentDatas"],
  };
  return { contract, iMint };
}

/**
 * Build an AgenticIDClient with a stubbed mint() so SessionAnchor can
 * exercise its forwarding logic without going through the receipt-parsing
 * path (which is already covered by agenticid-client.test.ts).
 */
function buildAgenticIdClient(opts?: {
  mintImpl?: (
    to: string,
    datas: ReadonlyArray<IntelligentData>,
    confirmations?: number,
  ) => Promise<MintResult>;
}): { client: AgenticIDClient; mintSpy: ReturnType<typeof vi.fn> } {
  const { contract } = buildAgenticIdContract();
  const client = new AgenticIDClient(PRE_DEPLOYED_AGENTICID, undefined, undefined, {
    contract,
  });
  const mintImpl =
    opts?.mintImpl ??
    (async () => ({ tokenId: MINT_TOKEN_ID, txHash: MINT_TX_HASH }));
  const mintSpy = vi.fn(mintImpl);
  client.mint = mintSpy as unknown as AgenticIDClient["mint"];
  return { client, mintSpy };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("SessionAnchor — constructor validation", () => {
  it("rejects a non-address agentId", () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    expect(() =>
      new SessionAnchor(logger, client, "not-an-address", MODEL_ID, {
        chainId: GALILEO_CHAIN_ID,
      }),
    ).toThrow(SessionAnchorError);
  });

  it("rejects an empty modelId", () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    expect(() =>
      new SessionAnchor(logger, client, VALID_AGENT_ADDRESS, "", {
        chainId: GALILEO_CHAIN_ID,
      }),
    ).toThrow(SessionAnchorError);
  });

  it("rejects a non-integer / zero / negative chainId", () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        new SessionAnchor(logger, client, VALID_AGENT_ADDRESS, MODEL_ID, {
          chainId: bad,
        }),
      ).toThrow(SessionAnchorError);
    }
  });

  it("rejects fractional or zero confirmations", () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        new SessionAnchor(logger, client, VALID_AGENT_ADDRESS, MODEL_ID, {
          chainId: GALILEO_CHAIN_ID,
          confirmations: bad,
        }),
      ).toThrow(SessionAnchorError);
    }
  });

  it("accepts the agreed 5-arg constructor shape: (sessionLogger, agenticIdClient, agentId, modelId, options)", () => {
    // Pins the contract that story-session-mint.md "Spec evolution"
    // section codifies. The original BDD had 4 args; we extended to 5
    // (with REQUIRED options.chainId) to eliminate the silent-mainnet-
    // URL risk. This test exists so the call-site shape doesn't
    // accidentally regress to a 4-arg form during a refactor — the
    // spec is enforced in code, not just in the markdown.
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    expect(anchor.agentId).toBe(VALID_AGENT_ADDRESS);
    expect(anchor.modelId).toBe(MODEL_ID);
  });

  it("the 5th `options` arg cannot be omitted — type-level enforcement (Codex R5)", () => {
    // Compile-time enforcement that the constructor signature is
    // 5-arg, not 4-arg-with-optional-options. If a future refactor
    // makes `options` optional (e.g., to "make migration easier"),
    // this test fails to compile via the @ts-expect-error directive.
    //
    // Note on directive placement: @ts-expect-error suppresses the
    // error on the IMMEDIATELY-following line. Splitting the call
    // across an outer `expect(() => ...)` wrapper would put the
    // `new SessionAnchor` expression 2+ lines below the directive,
    // making the directive "unused" per TS2578. The
    // `const construct = (): SessionAnchor => ...` shape keeps the
    // directive directly above the failing expression.
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    const construct = (): SessionAnchor =>
      // @ts-expect-error — omitting the 5th `options` arg must remain a compile error
      new SessionAnchor(logger, client, VALID_AGENT_ADDRESS, MODEL_ID);
    expect(construct).toThrow();
  });

  it("chainId is REQUIRED inside options — no Galileo default at the type level", () => {
    // Compile-time enforcement of the "no silent default chainId"
    // invariant codified in story-session-mint.md "Spec evolution".
    // If a future refactor makes chainId optional, this test fails to
    // compile via the @ts-expect-error directive — keeping the spec
    // and the implementation lock-stepped via the type system.
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    const construct = (): SessionAnchor =>
      // @ts-expect-error — omitting chainId inside options must remain a compile error
      new SessionAnchor(logger, client, VALID_AGENT_ADDRESS, MODEL_ID, {});
    expect(construct).toThrow();
  });
});

// ---------------------------------------------------------------------------
// anchor() input validation
// ---------------------------------------------------------------------------

describe("SessionAnchor.anchor — input validation", () => {
  it("throws SessionAnchorError when sessionId mismatches the bound logger", async () => {
    const logger = buildSessionLogger({ sessionId: "ses_a" });
    const { client } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await expect(
      anchor.anchor({ sessionId: "ses_b", containerHash: CONTAINER_HASH }),
    ).rejects.toBeInstanceOf(SessionAnchorError);
  });

  it("throws SessionAnchorError on a malformed containerHash", async () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await expect(
      anchor.anchor({ sessionId: SESSION_ID, containerHash: "0xabc" }),
    ).rejects.toBeInstanceOf(SessionAnchorError);
  });
});

// ---------------------------------------------------------------------------
// anchor() happy path — orchestration assertions
// ---------------------------------------------------------------------------

describe("SessionAnchor.anchor — orchestration", () => {
  it("flushes the session log then mints with ADR-08 dataDescription + the rootHash from flush", async () => {
    const logger = buildSessionLogger();
    // Append one entry so the flush has real content.
    logger.appendEntry({
      seq: 0,
      ts: Date.now(),
      type: "tool_call",
      tool: "noop",
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
    });

    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );

    const result = await anchor.anchor({
      sessionId: SESSION_ID,
      containerHash: CONTAINER_HASH,
    });

    // mint() received agentId as recipient + the constructed IntelligentData
    expect(mintSpy).toHaveBeenCalledTimes(1);
    const [recipient, datas] = mintSpy.mock.calls[0] as [
      string,
      IntelligentData[],
      number | undefined,
    ];
    expect(recipient).toBe(VALID_AGENT_ADDRESS);
    expect(datas).toHaveLength(1);
    expect(datas[0]).toEqual({
      dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
      dataHash: ROOT_HASH,
    });

    // AnchorResult fields all present + verifyUrl is the BDD pattern
    expect(result.tokenId).toBe(MINT_TOKEN_ID);
    expect(result.txHash).toBe(MINT_TX_HASH);
    expect(result.rootHash).toBe(ROOT_HASH);
    expect(result.entryCount).toBe(1);
    expect(result.verifyUrl).toBe(`/verify/${MINT_TOKEN_ID.toString()}`);
  });

  it("forwards the configured confirmations to mint()", async () => {
    const logger = buildSessionLogger();
    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID, confirmations: 3 },
    );
    await anchor.anchor({ sessionId: SESSION_ID, containerHash: CONTAINER_HASH });
    const call = mintSpy.mock.calls[0] as [
      string,
      ReadonlyArray<IntelligentData>,
      number | undefined,
    ];
    expect(call[2]).toBe(3);
  });

  it("late-binds metadata on the SessionLogger so flush() does not throw METADATA_MISSING", async () => {
    // Sanity check that the metadata wiring is right — without anchor()
    // setting metadata, SessionLogger.flush() throws "METADATA_MISSING".
    const logger = buildSessionLogger();
    await expect(logger.flush()).rejects.toThrow(/agentId, containerHash, and modelId/);
    // Re-build because flush() has set internal flushing state on failure
    // recovery; cleanest is a fresh logger for the anchor() pass.
    const logger2 = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger2,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await expect(
      anchor.anchor({ sessionId: SESSION_ID, containerHash: CONTAINER_HASH }),
    ).resolves.toMatchObject({ rootHash: ROOT_HASH });
  });

  it("wraps mint failure AFTER successful flush as SessionAnchorMintAfterFlushError exposing rootHash (Codex R8)", async () => {
    // The operational gap that motivates this wrapper: after a
    // successful flush, the SessionLogger is sealed (flushed=true),
    // so a second `anchor()` would throw ALREADY_FLUSHED. Without
    // the wrapper, the caller would get an AgenticIDMintError but
    // would have no way to recover — the log is on 0G Storage but
    // the on-chain anchor never happened. The wrapper exposes the
    // flushed rootHash so the caller can recover via retryMint().
    const logger = buildSessionLogger();
    // Mint stub that always fails — simulates the post-flush failure.
    const { client, mintSpy } = buildAgenticIdClient({
      mintImpl: async () => {
        throw new Error("intermittent gas-price spike: tx replaced");
      },
    });
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );

    let caught: SessionAnchorMintAfterFlushError | undefined;
    try {
      await anchor.anchor({ sessionId: SESSION_ID, containerHash: CONTAINER_HASH });
    } catch (err) {
      if (err instanceof SessionAnchorMintAfterFlushError) caught = err;
      else throw err;
    }
    expect(caught).toBeInstanceOf(SessionAnchorMintAfterFlushError);
    // Critical: rootHash must be exposed so the caller can retry mint
    // with it. Without this, the log is unrecoverable on 0G Storage.
    expect(caught!.rootHash).toBe(ROOT_HASH);
    expect(caught!.entryCount).toBe(0); // no entries appended in this test
    expect(caught!.sessionId).toBe(SESSION_ID);
    expect(caught!.dataDescription).toBe(`exec-log:${SESSION_ID}:${MODEL_ID}`);
    // The underlying mint cause must be preserved for diagnostics.
    expect(String((caught as Error).message)).toMatch(/gas-price spike/);
    expect(mintSpy).toHaveBeenCalledTimes(1);
    // The SessionLogger should NOT have flushing reset — confirming
    // it's truly sealed and the caller must use retryMint().
    await expect(logger.flush()).rejects.toThrow(/already flushed/);
  });

  it("retryMint() succeeds without re-flushing the SessionLogger (recovery path)", async () => {
    const logger = buildSessionLogger();
    // First-attempt mint stub fails; second-attempt (retryMint) succeeds.
    let callCount = 0;
    const mintImpl = async (
      _to: string,
      _datas: ReadonlyArray<IntelligentData>,
      _confirmations?: number,
    ): Promise<MintResult> => {
      callCount++;
      if (callCount === 1) {
        throw new Error("transient RPC failure");
      }
      return { tokenId: MINT_TOKEN_ID, txHash: MINT_TX_HASH };
    };
    const { client } = buildAgenticIdClient({ mintImpl });
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );

    // First call: mint fails, error exposes rootHash for retry.
    let firstErr: SessionAnchorMintAfterFlushError | undefined;
    try {
      await anchor.anchor({ sessionId: SESSION_ID, containerHash: CONTAINER_HASH });
    } catch (err) {
      if (err instanceof SessionAnchorMintAfterFlushError) firstErr = err;
      else throw err;
    }
    expect(firstErr).toBeDefined();

    // Recovery: pass the error's fields back into retryMint().
    const result = await anchor.retryMint({
      rootHash: firstErr!.rootHash,
      entryCount: firstErr!.entryCount,
      sessionId: firstErr!.sessionId,
    });
    expect(result.tokenId).toBe(MINT_TOKEN_ID);
    expect(result.txHash).toBe(MINT_TX_HASH);
    expect(result.rootHash).toBe(ROOT_HASH);
    // entryCount must round-trip from the error → retryMint → result
    expect(result.entryCount).toBe(0);
    expect(result.verifyUrl).toBe(
      `/verify/${MINT_TOKEN_ID.toString()}`,
    );
    // mint() was called twice — once in anchor(), once in retryMint().
    expect(callCount).toBe(2);
  });

  it("retryMint() validates inputs before touching the chain", async () => {
    const logger = buildSessionLogger();
    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );

    // Malformed rootHash (not 0x-prefixed bytes32).
    await expect(
      anchor.retryMint({ rootHash: "0xabc", entryCount: 1, sessionId: SESSION_ID }),
    ).rejects.toBeInstanceOf(SessionAnchorError);
    // Negative entryCount.
    await expect(
      anchor.retryMint({ rootHash: ROOT_HASH, entryCount: -1, sessionId: SESSION_ID }),
    ).rejects.toBeInstanceOf(SessionAnchorError);
    // Empty sessionId.
    await expect(
      anchor.retryMint({ rootHash: ROOT_HASH, entryCount: 1, sessionId: "" }),
    ).rejects.toBeInstanceOf(SessionAnchorError);
    // None of the validation failures should have called mint().
    expect(mintSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // v0.3.4 — dataDescriptionPrefix plumbing (orphan-recovery support)
  // -------------------------------------------------------------------------

  it("v0.3.4: AnchorInput.dataDescriptionPrefix overrides the default 'exec-log' prefix on mint", async () => {
    // Plugin's session_end orphan-recovery branch passes
    // "exec-log-orphan" so the dashboard can render a distinct
    // recovery-anchor badge. Without this hook, the orphan branch
    // would either have to call AgenticIDClient.mint() directly
    // (duplicating SessionAnchor's post-flush error handling) or
    // mislabel the token.
    const logger = buildSessionLogger();
    logger.appendEntry({
      seq: 0,
      ts: Date.now(),
      type: "tool_call",
      tool: "noop",
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
    });
    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await anchor.anchor({
      sessionId: SESSION_ID,
      containerHash: CONTAINER_HASH,
      dataDescriptionPrefix: "exec-log-orphan",
    });
    const datas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(datas[0].dataDescription).toBe(
      `exec-log-orphan:${SESSION_ID}:${MODEL_ID}`,
    );
  });

  it("v0.3.4: SessionAnchorMintAfterFlushError carries dataDescriptionPrefix so retry can preserve it", async () => {
    // Without the prefix on the error, an operator-driven retryMint()
    // would default back to "exec-log" — silently re-labeling an
    // orphan-recovery rootHash as a normal anchor. The dashboard
    // parser would then miscategorize the retry-minted token.
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient({
      mintImpl: async () => {
        throw new Error("transient RPC failure");
      },
    });
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    let caught: SessionAnchorMintAfterFlushError | undefined;
    try {
      await anchor.anchor({
        sessionId: SESSION_ID,
        containerHash: CONTAINER_HASH,
        dataDescriptionPrefix: "exec-log-orphan",
      });
    } catch (err) {
      if (err instanceof SessionAnchorMintAfterFlushError) caught = err;
      else throw err;
    }
    expect(caught).toBeDefined();
    expect(caught!.dataDescriptionPrefix).toBe("exec-log-orphan");
    expect(caught!.dataDescription).toBe(
      `exec-log-orphan:${SESSION_ID}:${MODEL_ID}`,
    );
    // The error message embeds the prefix in the suggested retry call
    // so a copy-paste recovery preserves it.
    expect(caught!.message).toContain(
      `dataDescriptionPrefix: "exec-log-orphan"`,
    );
  });

  it("v0.3.4: retryMint() honors dataDescriptionPrefix on the retry", async () => {
    // Recovery flow: anchor() failed post-flush, operator passes the
    // error's dataDescriptionPrefix back to retryMint(). Validate the
    // retry mints with the SAME prefix, not the default.
    const logger = buildSessionLogger();
    let callCount = 0;
    const mintImpl = async (
      _to: string,
      datas: ReadonlyArray<IntelligentData>,
      _confirmations?: number,
    ): Promise<MintResult> => {
      callCount++;
      if (callCount === 1) throw new Error("transient RPC failure");
      // Capture the retry call's dataDescription for the assertion below.
      expect(datas[0].dataDescription).toBe(
        `exec-log-orphan:${SESSION_ID}:${MODEL_ID}`,
      );
      return { tokenId: MINT_TOKEN_ID, txHash: MINT_TX_HASH };
    };
    const { client } = buildAgenticIdClient({ mintImpl });
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    let firstErr: SessionAnchorMintAfterFlushError | undefined;
    try {
      await anchor.anchor({
        sessionId: SESSION_ID,
        containerHash: CONTAINER_HASH,
        dataDescriptionPrefix: "exec-log-orphan",
      });
    } catch (err) {
      if (err instanceof SessionAnchorMintAfterFlushError) firstErr = err;
      else throw err;
    }
    expect(firstErr).toBeDefined();
    const result = await anchor.retryMint({
      rootHash: firstErr!.rootHash,
      entryCount: firstErr!.entryCount,
      sessionId: firstErr!.sessionId,
      dataDescriptionPrefix: firstErr!.dataDescriptionPrefix,
    });
    expect(result.tokenId).toBe(MINT_TOKEN_ID);
    expect(callCount).toBe(2);
  });

  it("v0.3.4: dataDescriptionPrefix default 'exec-log' preserved for v0.3.0-style callers", async () => {
    // Backwards compat: existing call sites (the smoke scripts, the
    // pre-v0.3.4 plugin code paths) don't pass dataDescriptionPrefix
    // and must still produce `exec-log:` anchors.
    const logger = buildSessionLogger();
    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await anchor.anchor({
      sessionId: SESSION_ID,
      containerHash: CONTAINER_HASH,
      // dataDescriptionPrefix intentionally omitted.
    });
    const datas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(datas[0].dataDescription).toBe(`exec-log:${SESSION_ID}:${MODEL_ID}`);
  });

  it("propagates StorageUploadError from flush() unchanged (does not wrap)", async () => {
    // SessionAnchor must not swallow lower-layer errors — operators
    // need the original class so they can branch on transport vs
    // contract failures.
    const logger = buildSessionLogger({
      uploadOverride: (async () => {
        throw new Error("upstream upload failed: ECONNRESET");
      }) as unknown as IndexerLike["upload"],
    });
    const { client, mintSpy } = buildAgenticIdClient();
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );
    await expect(
      anchor.anchor({ sessionId: SESSION_ID, containerHash: CONTAINER_HASH }),
    ).rejects.toThrow(/ECONNRESET/);
    // mint() must NOT have been called when flush failed.
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("verifyUrl is /verify/<tokenId> only — chainId is implicit from the deploy domain (subdomain-split)", async () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    // Pass mainnet chainId — but the URL must NOT bake it in. The
    // network is disambiguated by the verifyUrlBase domain
    // (testnet at root vs mainnet at subdomain), not the path.
    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: 16661 },
    );
    const result = await anchor.anchor({
      sessionId: SESSION_ID,
      containerHash: CONTAINER_HASH,
    });
    expect(result.verifyUrl).toBe(`/verify/${MINT_TOKEN_ID.toString()}`);
    // Defensive: assert the chainId is NOT in the path. Earlier
    // versions emitted `/verify/<chainId>/<tokenId>` which 404s on
    // the dashboard (which only routes `/verify/[tokenId]`).
    expect(result.verifyUrl).not.toContain("16661");
    expect(result.verifyUrl).not.toContain("16602");
  });

  // BDD coverage for: "Given the transaction is confirmed on-chain / When ethers.js
  // listens for Updated OR IntelligentDataSet events from the mint tx / Then at
  // least one event is emitted confirming the data anchor" (story-session-mint.md).
  //
  // The "or" in the BDD reflects the contract's two possible signals;
  // AgenticIDClient.mint() listens for IntelligentDataSet specifically (the
  // event our code uses to recover the assigned tokenId — see AGENTICID_ABI
  // in AgenticIDClient.ts). Asserting the IntelligentDataSet path therefore
  // satisfies the "at least one event" criterion: a receipt without it
  // throws AgenticIDMintEventMissingError before reaching the result here,
  // so a passing assertion proves the event was present AND parseable.
  //
  // The other orchestration tests stub AgenticIDClient.mint directly, so the
  // receipt/event path isn't exercised through SessionAnchor — Codex P2
  // round 1 on PR #19 caught the gap. This test routes through the REAL
  // AgenticIDClient.mint() with a contract stub returning a receipt that
  // contains an ABI-encoded IntelligentDataSet log.
  it("receipt's IntelligentDataSet event drives AnchorResult.tokenId (BDD: 'at least one event ... data anchor')", async () => {
    const logger = buildSessionLogger();
    const expectedTokenId = 7n;
    const expectedTxHash = `0x${"e".repeat(64)}`;

    // Encode a real IntelligentDataSet log against the bundled ABI so
    // AgenticIDClient's receipt parser can decode it without any
    // patching. Matches the helper pattern in agenticid-client.test.ts.
    const iface = new Interface(AGENTICID_ABI);
    const eventFragment = iface.getEvent("IntelligentDataSet");
    if (eventFragment === null) {
      throw new Error("IntelligentDataSet event missing from AGENTICID_ABI");
    }
    const expectedDatas: IntelligentData[] = [
      {
        dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
        dataHash: ROOT_HASH,
      },
    ];
    const encodedEvent = iface.encodeEventLog(eventFragment, [
      expectedTokenId,
      expectedDatas,
    ]);
    const eventLog = {
      address: PRE_DEPLOYED_AGENTICID,
      topics: encodedEvent.topics as string[],
      data: encodedEvent.data,
      blockNumber: 1,
      blockHash: `0x${"1".repeat(64)}`,
      transactionHash: expectedTxHash,
      transactionIndex: 0,
      index: 0,
      removed: false,
    } as unknown as Log;
    const receipt = {
      hash: expectedTxHash,
      blockNumber: 1,
      logs: [eventLog],
      status: 1,
    } as unknown as TransactionReceipt;
    const txResponse = {
      hash: expectedTxHash,
      wait: vi.fn().mockResolvedValue(receipt),
    } as unknown as ContractTransactionResponse;

    const iMintSpy = vi.fn(async () => txResponse);
    const contract: AgenticIDContractLike = {
      iMint: iMintSpy as unknown as AgenticIDContractLike["iMint"],
      getIntelligentDatas: (async () =>
        expectedDatas) as unknown as AgenticIDContractLike["getIntelligentDatas"],
    };
    // Real AgenticIDClient (no mint stub) so the receipt path runs.
    const client = new AgenticIDClient(
      PRE_DEPLOYED_AGENTICID,
      undefined,
      undefined,
      { contract },
    );

    const anchor = new SessionAnchor(
      logger,
      client,
      VALID_AGENT_ADDRESS,
      MODEL_ID,
      { chainId: GALILEO_CHAIN_ID },
    );

    const result = await anchor.anchor({
      sessionId: SESSION_ID,
      containerHash: CONTAINER_HASH,
    });

    // The tokenId surfaced in the AnchorResult ONLY if the receipt's
    // IntelligentDataSet log was successfully decoded by mint(). If the
    // event were absent, AgenticIDMintEventMissingError would have been
    // thrown before reaching this assertion.
    expect(result.tokenId).toBe(expectedTokenId);
    expect(result.txHash).toBe(expectedTxHash);
    expect(result.verifyUrl).toBe(
      `/verify/${expectedTokenId.toString()}`,
    );
    // Sanity: contract was actually invoked with the SessionAnchor-built
    // payload — proves the orchestration didn't accidentally short-circuit.
    expect(iMintSpy).toHaveBeenCalledWith(VALID_AGENT_ADDRESS, expectedDatas);
  });
});

// ---------------------------------------------------------------------------
// Live-mint integration — gated on PRIVATE_KEY (funded testnet wallet)
//
// BDD acceptance from story-session-mint.md:
//   Given the transaction is confirmed on-chain
//   When ethers.js listens for Updated or IntelligentDataSet events
//   Then at least one event is emitted confirming the data anchor
//
// The unit suite above proves orchestration + receipt parsing, but it
// uses fabricated receipts from stub contracts — so it covers the
// "receipt parsing" half of "confirmed on-chain" but NOT actual chain
// confirmation. Codex R3 on PR #19 caught this gap explicitly.
//
// This gated suite closes it: when the env is wired (PRIVATE_KEY +
// ZG_TESTNET_RPC + ZG_INDEXER_RPC + AGENTICID_ADDRESS), it stands up
// the REAL component graph (StorageClient → SessionLogger →
// AgenticIDClient → SessionAnchor) and runs `anchor()` against
// Galileo testnet. CI without env vars skips silently — matches the
// agenticid-client.test.ts "live mint" pattern.
// ---------------------------------------------------------------------------

const liveAnchorEnvReady =
  Boolean((process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC)) &&
  Boolean(process.env.ZG_INDEXER_RPC) &&
  Boolean(process.env.AGENTICID_ADDRESS) &&
  Boolean(process.env.PRIVATE_KEY);

describe.skipIf(!liveAnchorEnvReady)(
  "SessionAnchor — Galileo live anchor (integration, gated on PRIVATE_KEY)",
  () => {
    it("flushes a real session log to 0G Storage and mints a real iNFT, returning a tokenId from the on-chain event", async () => {
      const { JsonRpcProvider, Wallet } = await import("ethers");
      const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
      const provider = new JsonRpcProvider((process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC));
      const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

      // Pin chain identity before spending gas — exact same defensive
      // pattern as the AgenticIDClient gated test.
      const network = await provider.getNetwork();
      expect(network.chainId).toBe(16602n);

      const indexer = new Indexer(process.env.ZG_INDEXER_RPC!);
      const storage = new StorageClient({
        rpcUrl: (process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC)!,
        indexerUrl: process.env.ZG_INDEXER_RPC!,
        signer,
        indexer: indexer as unknown as IndexerLike,
      });
      const liveSessionId = `ses_live_${Date.now()}`;
      const logger = new SessionLogger(liveSessionId, storage);
      // Append one entry so the flushed blob isn't empty (entryCount=0
      // is valid but uninteresting). Using a deterministic shape so
      // the blob hashes consistently across reruns.
      logger.appendEntry({
        seq: 0,
        ts: Date.now(),
        type: "tool_call",
        tool: "live-integration-noop",
        inputHash: "a".repeat(64),
        outputHash: "b".repeat(64),
      });

      const agenticIdClient = new AgenticIDClient(
        process.env.AGENTICID_ADDRESS!,
        provider,
        signer,
      );
      const anchor = new SessionAnchor(
        logger,
        agenticIdClient,
        signer.address,
        MODEL_ID,
        { chainId: 16602 },
      );

      // Real container hash — keccak-style 32-byte, but content is
      // arbitrary (the on-chain anchor doesn't validate it semantically).
      const liveContainerHash = `0x${"f".repeat(64)}`;

      const start = Date.now();
      const result = await anchor.anchor({
        sessionId: liveSessionId,
        containerHash: liveContainerHash,
      });
      const elapsed = Date.now() - start;

      expect(result.tokenId).toBeGreaterThanOrEqual(0n);
      expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
      expect(result.rootHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
      expect(result.entryCount).toBe(1);
      expect(result.verifyUrl).toBe(
        `/verify/${result.tokenId.toString()}`,
      );
      // BDD wall-clock: "appears on the block explorer within 60s"
      // (mirroring story-agenticid-client). 90s soft cap to absorb
      // 0G Storage upload time + iMint confirmation + Galileo block
      // jitter — anything slower indicates a real degradation.
      expect(elapsed).toBeLessThanOrEqual(90_000);

      // Read-back through AgenticIDClient — proves the on-chain anchor
      // is queryable (not just that the tx confirmed). This is the
      // "Then at least one event is emitted confirming the data anchor"
      // BDD line: getIntelligentDatas only returns data if iMint
      // committed and the event was indexed.
      const readBack = await agenticIdClient.getIntelligentDatas(
        result.tokenId,
      );
      expect(readBack.length).toBe(1);
      expect(readBack[0].dataDescription).toBe(
        `exec-log:${liveSessionId}:${MODEL_ID}`,
      );
      expect(readBack[0].dataHash).toBe(result.rootHash);
    }, 120_000);
  },
);
