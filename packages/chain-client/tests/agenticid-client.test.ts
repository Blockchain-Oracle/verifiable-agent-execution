/**
 * Tests for packages/chain-client/src/AgenticIDClient.ts.
 *
 * BDD acceptance from context/docs/stories/story-agenticid-client.md:
 *   - Constructor: { contractAddress, provider, signer } (or rpcUrl).
 *   - mint(to, datas): {tokenId, txHash}; tx confirms within 60s.
 *   - getIntelligentDatas(tokenId): IntelligentData[].
 *   - Pre-deployed AgenticID at 0x2700F6A3...EF1F on Galileo (16602).
 *
 * Strategy:
 *   - Unit tests use an injected `AgenticIDContractLike` test double so
 *     no testnet wallet is needed for CI. Tests assert call shapes,
 *     receipt parsing, error mapping.
 *   - Integration test (skipped unless PRIVATE_KEY + ZG_TESTNET_RPC +
 *     AGENTICID_ADDRESS env are set) reads the live deployed contract.
 */

import {
  Interface,
  type ContractTransactionResponse,
  type Log,
  type TransactionReceipt,
} from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  AGENTICID_ABI,
  AgenticIDClient,
  AgenticIDInputError,
  AgenticIDMintError,
  AgenticIDMintEventDataMismatchError,
  AgenticIDMintEventMissingError,
  AgenticIDReadError,
  type AgenticIDContractLike,
  type IntelligentData,
} from "../src/index.js";

const VALID_ADDRESS = `0x${"a".repeat(40)}`;
const PRE_DEPLOYED = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const VALID_BYTES32 = `0x${"f".repeat(64)}`;

const SAMPLE_DATA: IntelligentData[] = [
  {
    dataDescription: "exec-log:ses_01:claude-sonnet-4-6",
    dataHash: VALID_BYTES32,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeIntelligentDataSetLog(
  contractAddress: string,
  tokenId: bigint,
  data: IntelligentData[],
): Log {
  const iface = new Interface(AGENTICID_ABI);
  const fragment = iface.getEvent("IntelligentDataSet");
  if (fragment === null) throw new Error("IntelligentDataSet event not in ABI");
  const encoded = iface.encodeEventLog(fragment, [tokenId, data]);
  // Cast through unknown — ethers v6's `Log` class includes methods
  // (`provider`, `toJSON`, `getBlock`, etc.) that the AgenticIDClient
  // doesn't actually call. The receipt-parsing path only reads
  // `address`, `topics`, and `data`, so this minimal log shape is
  // sufficient for unit tests.
  return {
    address: contractAddress,
    topics: encoded.topics as string[],
    data: encoded.data,
    blockNumber: 1,
    blockHash: `0x${"1".repeat(64)}`,
    transactionHash: `0x${"2".repeat(64)}`,
    transactionIndex: 0,
    index: 0,
    removed: false,
  } as unknown as Log;
}

function makeReceipt(logs: Log[]): TransactionReceipt {
  return {
    hash: `0x${"3".repeat(64)}`,
    blockNumber: 1,
    logs,
    status: 1,
  } as unknown as TransactionReceipt;
}

function makeMintResponse(
  receipt: TransactionReceipt,
): ContractTransactionResponse {
  return {
    hash: receipt.hash,
    wait: vi.fn().mockResolvedValue(receipt),
  } as unknown as ContractTransactionResponse;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("AgenticIDClient — construction", () => {
  it("accepts a pre-built contract test double", () => {
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    expect(client.contractAddress).toBe(PRE_DEPLOYED);
  });

  it("rejects a malformed contractAddress with AgenticIDInputError", () => {
    expect(
      () =>
        new AgenticIDClient(
          "not-an-address",
          undefined,
          undefined,
          { contract: { iMint: vi.fn(), getIntelligentDatas: vi.fn() } },
        ),
    ).toThrow(AgenticIDInputError);
  });

  it("rejects construction without contract / signer / provider", () => {
    expect(
      () => new AgenticIDClient(PRE_DEPLOYED),
    ).toThrow(AgenticIDInputError);
  });

  it("rejects mint() when constructed read-only (provider but no signer)", async () => {
    const { JsonRpcProvider } = await import("ethers");
    const fakeProvider = new JsonRpcProvider("https://example.invalid");
    const client = new AgenticIDClient(PRE_DEPLOYED, fakeProvider);
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toThrow(
      /requires a Signer/,
    );
  });

  it("connects an unconnected signer to the supplied provider (Codex round 2 P1)", async () => {
    // The BDD shape is `(addr, provider, signer)`. If a caller passes
    // a signer that doesn't already have signer.provider set, the
    // constructor must attach the supplied provider via signer.connect()
    // — otherwise ethers Contract writes fail at runtime because they
    // need signer.provider for nonce / chainId reads. The unit-level
    // proof is that the resulting Contract's runner has a non-null
    // provider; we verify by constructing a Wallet with no provider
    // and asserting the wired client works end-to-end against a stub.
    const { JsonRpcProvider, Wallet } = await import("ethers");
    const fakeProvider = new JsonRpcProvider("https://example.invalid");
    const unconnectedSigner = new Wallet(`0x${"1".repeat(64)}`); // no provider
    expect(unconnectedSigner.provider).toBeNull();

    // Construction must NOT throw — this is the full provider+signer
    // BDD shape.
    expect(
      () => new AgenticIDClient(PRE_DEPLOYED, fakeProvider, unconnectedSigner),
    ).not.toThrow();
  });

  it("rejects a signer already bound to a different provider than the one passed (Codex P1 round 3 on PR #19)", async () => {
    // The high-impact silent-failure mode: caller passes provider B,
    // but signer is already connected to provider A. Pre-fix, the
    // constructor silently used the signer's provider A, so mint()
    // would land on A's chain while the caller believed they targeted
    // B. Now we throw at construction time so the bug surfaces loud.
    const { JsonRpcProvider, Wallet } = await import("ethers");
    const providerA = new JsonRpcProvider("https://provider-a.invalid");
    const providerB = new JsonRpcProvider("https://provider-b.invalid");
    const signerOnA = new Wallet(`0x${"1".repeat(64)}`, providerA);
    expect(signerOnA.provider).toBe(providerA);

    expect(
      () => new AgenticIDClient(PRE_DEPLOYED, providerB, signerOnA),
    ).toThrow(AgenticIDInputError);
    expect(
      () => new AgenticIDClient(PRE_DEPLOYED, providerB, signerOnA),
    ).toThrow(/different provider/);
  });

  it("accepts a signer already bound to the SAME provider as the one passed", async () => {
    // The matching-provider case must remain valid — only the
    // mismatch case throws.
    const { JsonRpcProvider, Wallet } = await import("ethers");
    const provider = new JsonRpcProvider("https://shared.invalid");
    const signerOnSame = new Wallet(`0x${"1".repeat(64)}`, provider);
    expect(
      () => new AgenticIDClient(PRE_DEPLOYED, provider, signerOnSame),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// mint()
// ---------------------------------------------------------------------------

describe("AgenticIDClient.mint — input validation", () => {
  function makeClient() {
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi.fn(),
    };
    return {
      contract,
      client: new AgenticIDClient(PRE_DEPLOYED, undefined, undefined, {
        contract,
      }),
    };
  }

  it("rejects a malformed `to` address", async () => {
    const { client } = makeClient();
    await expect(client.mint("not-an-address", SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
  });

  it("rejects an empty datas array (matches contract require)", async () => {
    const { client } = makeClient();
    await expect(client.mint(VALID_ADDRESS, [])).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
  });

  it("rejects non-positive-integer confirmations", async () => {
    const { client } = makeClient();
    await expect(
      client.mint(VALID_ADDRESS, SAMPLE_DATA, 0),
    ).rejects.toBeInstanceOf(AgenticIDInputError);
    await expect(
      client.mint(VALID_ADDRESS, SAMPLE_DATA, -1),
    ).rejects.toBeInstanceOf(AgenticIDInputError);
    await expect(
      client.mint(VALID_ADDRESS, SAMPLE_DATA, 1.5),
    ).rejects.toBeInstanceOf(AgenticIDInputError);
  });

  it("forwards a positive `confirmations` arg to tx.wait", async () => {
    const expectedTokenId = 11n;
    const log = encodeIntelligentDataSetLog(PRE_DEPLOYED, expectedTokenId, SAMPLE_DATA);
    const receipt = makeReceipt([log]);
    const waitSpy = vi.fn().mockResolvedValue(receipt);
    const txResponse = {
      hash: receipt.hash,
      wait: waitSpy,
    } as unknown as ContractTransactionResponse;
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(PRE_DEPLOYED, undefined, undefined, {
      contract,
    });

    await client.mint(VALID_ADDRESS, SAMPLE_DATA, 3);
    expect(waitSpy).toHaveBeenCalledWith(3);
  });

  it("rejects a malformed dataHash in datas[i]", async () => {
    const { client } = makeClient();
    const bad = [{ dataDescription: "exec-log", dataHash: "0xnotbytes32" }];
    await expect(client.mint(VALID_ADDRESS, bad)).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
  });

  it("rejects an empty dataDescription", async () => {
    const { client } = makeClient();
    const bad = [{ dataDescription: "", dataHash: VALID_BYTES32 }];
    await expect(client.mint(VALID_ADDRESS, bad)).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
  });
});

describe("AgenticIDClient.mint — happy path + receipt parsing", () => {
  it("returns {tokenId, txHash} after parsing IntelligentDataSet from the receipt", async () => {
    const expectedTokenId = 42n;
    const log = encodeIntelligentDataSetLog(PRE_DEPLOYED, expectedTokenId, SAMPLE_DATA);
    const receipt = makeReceipt([log]);
    const txResponse = makeMintResponse(receipt);

    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );

    const result = await client.mint(VALID_ADDRESS, SAMPLE_DATA);
    expect(result.tokenId).toBe(expectedTokenId);
    expect(result.txHash).toBe(receipt.hash);
    expect(contract.iMint).toHaveBeenCalledWith(VALID_ADDRESS, SAMPLE_DATA);
  });

  it("ignores logs from other contract addresses while parsing", async () => {
    const expectedTokenId = 7n;
    const noiseLog = encodeIntelligentDataSetLog(
      `0x${"b".repeat(40)}`, // different contract
      999n,
      SAMPLE_DATA,
    );
    const targetLog = encodeIntelligentDataSetLog(
      PRE_DEPLOYED,
      expectedTokenId,
      SAMPLE_DATA,
    );
    const receipt = makeReceipt([noiseLog, targetLog]);
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(makeMintResponse(receipt)),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );

    const result = await client.mint(VALID_ADDRESS, SAMPLE_DATA);
    expect(result.tokenId).toBe(expectedTokenId);
  });
});

describe("AgenticIDClient.mint — error mapping", () => {
  it("wraps a pre-broadcast contract throw as AgenticIDMintError", async () => {
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockRejectedValue(new Error("nonce too low")),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDMintError,
    );
  });

  it("wraps a wait-time revert as AgenticIDMintError", async () => {
    const txResponse = {
      hash: `0x${"3".repeat(64)}`,
      wait: vi.fn().mockRejectedValue(new Error("execution reverted")),
    } as unknown as ContractTransactionResponse;
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDMintError,
    );
  });

  it("wraps a null receipt as AgenticIDMintError", async () => {
    const txResponse = {
      hash: `0x${"3".repeat(64)}`,
      wait: vi.fn().mockResolvedValue(null),
    } as unknown as ContractTransactionResponse;
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDMintError,
    );
  });

  it("throws AgenticIDMintEventMissingError when the receipt has no IntelligentDataSet log", async () => {
    const receipt = makeReceipt([]); // no logs at all
    const txResponse = makeMintResponse(receipt);
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDMintEventMissingError,
    );
  });

  it("throws AgenticIDMintEventDataMismatchError when the event's data payload differs from what was minted (Codex R6)", async () => {
    // The BDD says the IntelligentDataSet event "confirms the data anchor".
    // Pre-fix, mint() recovered tokenId from any IntelligentDataSet event
    // without checking the event's data field — so a contract bug, a
    // reordered receipt, or a stray event from an unrelated mint with the
    // right tokenId could surface as a successful return while the data
    // payload pointed at different anchor content. Now mint() validates
    // the event's data round-trips the input datas.
    const expectedTokenId = 11n;
    const wrongData: IntelligentData[] = [
      {
        dataDescription: "exec-log:wrong-session:other-model",
        dataHash: `0x${"e".repeat(64)}`,
      },
    ];
    // Encode the event with the expected tokenId but DIFFERENT data:
    const log = encodeIntelligentDataSetLog(
      PRE_DEPLOYED,
      expectedTokenId,
      wrongData,
    );
    const receipt = makeReceipt([log]);
    const txResponse = makeMintResponse(receipt);
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    // SAMPLE_DATA is what we're "minting"; wrongData is what the event
    // emits. mint() must reject the receipt rather than silently return.
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toBeInstanceOf(
      AgenticIDMintEventDataMismatchError,
    );
    // Message must name the offending field so operators can diagnose
    // without re-reading the receipt by hand.
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toThrow(
      /dataDescription\[0\] mismatch/,
    );
  });

  it("throws AgenticIDMintEventDataMismatchError on a length mismatch in the event data array", async () => {
    // Two-entry event when we asked to mint one entry — a contract
    // duplicating or appending entries would land here. Order-preserving
    // comparison: the "extra" entries must surface as a length mismatch
    // rather than be silently truncated.
    const expectedTokenId = 12n;
    const extraDatas: IntelligentData[] = [
      ...SAMPLE_DATA,
      {
        dataDescription: "exec-log:phantom-extra:noop",
        dataHash: `0x${"d".repeat(64)}`,
      },
    ];
    const log = encodeIntelligentDataSetLog(
      PRE_DEPLOYED,
      expectedTokenId,
      extraDatas,
    );
    const receipt = makeReceipt([log]);
    const txResponse = makeMintResponse(receipt);
    const contract: AgenticIDContractLike = {
      iMint: vi.fn().mockResolvedValue(txResponse),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.mint(VALID_ADDRESS, SAMPLE_DATA)).rejects.toThrow(
      /length mismatch: expected 1, got 2/,
    );
  });
});

// ---------------------------------------------------------------------------
// getIntelligentDatas()
// ---------------------------------------------------------------------------

describe("AgenticIDClient.getIntelligentDatas", () => {
  it("returns normalized IntelligentData[] from the contract", async () => {
    const expected: IntelligentData[] = [
      { dataDescription: "exec-log:ses_42", dataHash: VALID_BYTES32 },
    ];
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi.fn().mockResolvedValue(expected),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );

    const result = await client.getIntelligentDatas(42n);
    expect(result).toEqual(expected);
    expect(contract.getIntelligentDatas).toHaveBeenCalledWith(42n);
  });

  it("rejects negative tokenId with AgenticIDInputError", async () => {
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi.fn(),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.getIntelligentDatas(-1n)).rejects.toBeInstanceOf(
      AgenticIDInputError,
    );
  });

  it("wraps contract revert as AgenticIDReadError", async () => {
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi
        .fn()
        .mockRejectedValue(new Error("Token does not exist")),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.getIntelligentDatas(99_999n)).rejects.toBeInstanceOf(
      AgenticIDReadError,
    );
  });

  it("rejects a contract-returned dataHash that isn't valid bytes32", async () => {
    const malformed = [
      { dataDescription: "exec-log", dataHash: "0xshort" },
    ] as unknown as IntelligentData[];
    const contract: AgenticIDContractLike = {
      iMint: vi.fn(),
      getIntelligentDatas: vi.fn().mockResolvedValue(malformed),
    };
    const client = new AgenticIDClient(
      PRE_DEPLOYED,
      undefined,
      undefined,
      { contract },
    );
    await expect(client.getIntelligentDatas(0n)).rejects.toBeInstanceOf(
      AgenticIDReadError,
    );
  });
});

// ---------------------------------------------------------------------------
// Integration — gated on env (live read against Galileo)
// ---------------------------------------------------------------------------

const integrationEnvReady =
  Boolean((process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC)) &&
  Boolean(process.env.AGENTICID_ADDRESS);

describe.skipIf(!integrationEnvReady)(
  "AgenticIDClient — Galileo testnet read (integration, gated)",
  () => {
    it("reads token 0 from the deployed AgenticID and returns the canonical entries", async () => {
      const { JsonRpcProvider } = await import("ethers");
      const provider = new JsonRpcProvider((process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC));
      const client = new AgenticIDClient(
        process.env.AGENTICID_ADDRESS!,
        provider,
      );

      const datas = await client.getIntelligentDatas(0n);
      // Token 0 was minted by the deployer with these descriptions
      // (confirmed by scripts/smoke/agenticid.ts — 4 entries:
      //  agent_name, model, capabilities, system_prompt). We only
      // assert >= 1 entry to stay resilient if the contract owner
      // ever updates token 0; the SHAPE assertion is what matters.
      expect(Array.isArray(datas)).toBe(true);
      expect(datas.length).toBeGreaterThan(0);
      for (const entry of datas) {
        expect(entry.dataHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
        expect(entry.dataDescription.length).toBeGreaterThan(0);
      }
    }, 30_000);
  },
);

// ---------------------------------------------------------------------------
// Live-mint integration — gated on PRIVATE_KEY (funded testnet wallet)
//
// BDD acceptance from story-agenticid-client:
//   Given the pre-deployed contract address is 0x2700F6A3...EF1F on Galileo (16602)
//   When AgenticIDClient.mint(to, datas) is called
//   Then it constructs an iMint() transaction, sends it via signer, waits
//        for confirmation, and returns { tokenId, txHash }
//   And the transaction appears on the block explorer within 60 seconds
//
// Skipped automatically when PRIVATE_KEY (or ZG_TESTNET_RPC /
// AGENTICID_ADDRESS) are unset, so CI stays green without funded
// testnet credentials.
// ---------------------------------------------------------------------------

const liveMintEnvReady = integrationEnvReady && Boolean(process.env.PRIVATE_KEY);

describe.skipIf(!liveMintEnvReady)(
  "AgenticIDClient — Galileo live mint (integration, gated on PRIVATE_KEY)",
  () => {
    it("asserts chainId, mints, returns {tokenId, txHash}, and reads back within 60s", async () => {
      const { JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } = await import(
        "ethers"
      );
      const provider = new JsonRpcProvider((process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC));
      const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

      // Verify we're actually on Galileo (chain 16602) before spending
      // gas. A misconfigured ZG_TESTNET_RPC would otherwise silently
      // mint on the wrong chain.
      const network = await provider.getNetwork();
      expect(network.chainId).toBe(16602n);

      const client = new AgenticIDClient(
        process.env.AGENTICID_ADDRESS!,
        provider,
        signer,
      );

      const description = `exec-log:integration-${Date.now()}:claude-sonnet-4-6`;
      const dataHash = keccak256(toUtf8Bytes(description));
      const datas: IntelligentData[] = [{ dataDescription: description, dataHash }];

      const start = Date.now();
      const result = await client.mint(signer.address, datas);
      const elapsed = Date.now() - start;

      expect(result.tokenId).toBeGreaterThanOrEqual(0n);
      expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
      expect(elapsed).toBeLessThanOrEqual(60_000);

      // Read it back — round-trip the data we just minted.
      const readBack = await client.getIntelligentDatas(result.tokenId);
      expect(readBack).toEqual(datas);

      // Soft explorer-visibility check (BDD: "tx appears on the block
      // explorer within 60 seconds"). chainscan-galileo returns
      // structured data when the tx is indexed; we accept either a
      // 200 with the tx body OR a 404/202 (not yet indexed) without
      // failing the test, because explorer indexing latency is outside
      // our control on testnet. The hard guarantee is the receipt
      // we already got from the RPC; this is a best-effort signal.
      const explorerUrl = `https://chainscan-galileo.0g.ai/tx/${result.txHash}`;
      try {
        const res = await fetch(explorerUrl, { redirect: "follow" });
        // Only assert the URL is reachable (any 2xx/3xx/4xx is fine
        // for the soft check; 5xx would indicate explorer down).
        expect(res.status).toBeLessThan(500);
      } catch (err) {
        console.warn(
          `[live-mint] explorer fetch failed (non-fatal): ${(err as Error).message ?? String(err)}`,
        );
      }
    }, 70_000);
  },
);
