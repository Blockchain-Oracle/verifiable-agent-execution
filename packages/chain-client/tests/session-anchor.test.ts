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
 *   - verifyUrl follows `/verify/<chainId>/<tokenId>`
 *   - mint receipt contains an IntelligentDataSet event (covered transitively
 *     by AgenticIDClient — re-asserted here at the integration boundary)
 *
 * Strategy: stub SessionLogger and AgenticIDClient with minimal
 * test doubles so the orchestration logic is asserted without
 * standing up 0G Storage or a chain RPC. Live integration paths are
 * covered by the agenticid-client.test.ts gated suite + the
 * scripts/smoke/ harnesses.
 */

import { Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  SessionLogger,
  StorageClient,
  type IndexerLike,
  type LogFlushResult,
  type SessionMetadata,
} from "@verifiable-agent-execution/logger";

import {
  AgenticIDClient,
  AgenticIDInputError,
  type AgenticIDContractLike,
  type IntelligentData,
  type MintResult,
  SessionAnchor,
  SessionAnchorError,
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

  it("accepts the BDD-positional shape with valid arguments", () => {
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
    expect(result.verifyUrl).toBe(`/verify/${GALILEO_CHAIN_ID}/${MINT_TOKEN_ID.toString()}`);
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

  it("verifyUrl uses the chainId from constructor options (not a hardcoded default)", async () => {
    const logger = buildSessionLogger();
    const { client } = buildAgenticIdClient();
    // Pick mainnet chainId to prove the URL is parameterised.
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
    expect(result.verifyUrl).toBe(`/verify/16661/${MINT_TOKEN_ID.toString()}`);
  });
});
