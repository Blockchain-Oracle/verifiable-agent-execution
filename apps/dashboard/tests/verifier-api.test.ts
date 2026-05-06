/**
 * Tests for apps/dashboard/src/lib/verify-proof.ts.
 *
 * BDD acceptance from context/docs/stories/story-verifier-api.md:
 *   - Returns {tokenId, sessionId, rootHash, entryCount, verified, entries[]}
 *   - 404 with machine-readable code when tokenId doesn't exist
 *   - entries.length >= 1 with at least one entry having tool/ts/inputHash/outputHash
 *
 * Strategy: stub the AgenticIDClient + StorageClient at the module
 * level via vi.mock so the resolveProof function exercises the real
 * orchestration logic against deterministic test data without
 * standing up Galileo testnet or the 0G SDK.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Set required env BEFORE importing the module under test — env.ts
// validates at module load. Same shape as the .env.example file.
process.env.ZG_TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
process.env.ZG_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
process.env.AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
process.env.CHAIN_ID = "16602";

// Module-level mocks — must be declared BEFORE the import that
// triggers their evaluation. vi.mock is hoisted by Vitest so this
// works regardless of file order.
vi.mock("@verifiable-agent-execution/chain-client", async () => {
  const actual = await vi.importActual<
    typeof import("@verifiable-agent-execution/chain-client")
  >("@verifiable-agent-execution/chain-client");
  return {
    ...actual,
    // Replace AgenticIDClient with a class whose constructor accepts
    // anything and exposes a stubbable `getIntelligentDatas`.
    AgenticIDClient: class FakeAgenticIDClient {
      static fromRpc() {
        return new FakeAgenticIDClient();
      }
      async getIntelligentDatas(): Promise<unknown[]> {
        throw new Error("not stubbed for this test");
      }
    },
  };
});

vi.mock("@verifiable-agent-execution/logger", async () => {
  const actual = await vi.importActual<
    typeof import("@verifiable-agent-execution/logger")
  >("@verifiable-agent-execution/logger");
  return {
    ...actual,
    StorageClient: class FakeStorageClient {
      constructor(_opts: unknown) {}
      async download(): Promise<Uint8Array> {
        throw new Error("not stubbed for this test");
      }
    },
  };
});

vi.mock("@0gfoundation/0g-storage-ts-sdk", () => ({
  Indexer: class FakeIndexer {
    constructor(_url: string) {}
  },
}));

import { ProofResolutionError, resolveProof } from "@/lib/verify-proof";
import {
  AgenticIDClient,
  type IntelligentData,
} from "@verifiable-agent-execution/chain-client";
import { StorageClient } from "@verifiable-agent-execution/logger";

const VALID_ROOT_HASH = `0x${"a".repeat(64)}`;
const SESSION_ID = "ses_test_01";
const MODEL_ID = "claude-sonnet-4-6";

function makeSessionLogBytes(overrides: Record<string, unknown> = {}): Uint8Array {
  const base = {
    sessionId: SESSION_ID,
    startedAt: 1700000000000,
    endedAt: 1700000000500,
    agentId: `0x${"a".repeat(40)}`,
    containerHash: `0x${"c".repeat(64)}`,
    modelId: MODEL_ID,
    entries: [
      {
        seq: 0,
        ts: 1700000000050,
        type: "tool_call" as const,
        tool: "web_search",
        inputHash: "a".repeat(64),
        outputHash: "b".repeat(64),
      },
    ],
    entryCount: 1,
  };
  const merged = { ...base, ...overrides };
  return new TextEncoder().encode(JSON.stringify(merged));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolveProof — happy path", () => {
  it("returns the BDD-required shape when chain + storage both succeed", async () => {
    const datas: IntelligentData[] = [
      {
        dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
        dataHash: VALID_ROOT_HASH,
      },
    ];
    vi.spyOn(
      AgenticIDClient.prototype as unknown as { getIntelligentDatas: () => Promise<IntelligentData[]> },
      "getIntelligentDatas",
    ).mockResolvedValue(datas);
    vi.spyOn(
      StorageClient.prototype as unknown as { download: () => Promise<Uint8Array> },
      "download",
    ).mockResolvedValue(makeSessionLogBytes());

    const proof = await resolveProof("42");
    expect(proof).toMatchObject({
      tokenId: "42",
      sessionId: SESSION_ID,
      rootHash: VALID_ROOT_HASH,
      entryCount: 1,
      verified: "preview", // TEE_VERIFIER_ADDRESS unset → mock
    });
    expect(proof.entries.length).toBeGreaterThanOrEqual(1);
    const first = proof.entries[0];
    expect(first.tool).toBe("web_search");
    expect(typeof first.ts).toBe("number");
    expect(first.inputHash).toBe("a".repeat(64));
    expect(first.outputHash).toBe("b".repeat(64));
    expect(proof.meta.chainId).toBe(16602);
  });

  it("picks the exec-log entry even when the token has multiple IntelligentData entries", async () => {
    const datas: IntelligentData[] = [
      { dataDescription: "agent_name", dataHash: `0x${"1".repeat(64)}` },
      { dataDescription: "model", dataHash: `0x${"2".repeat(64)}` },
      { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
    ];
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockResolvedValue(
      datas as never,
    );
    vi.spyOn(StorageClient.prototype as never, "download").mockResolvedValue(
      makeSessionLogBytes() as never,
    );
    const proof = await resolveProof("7");
    expect(proof.rootHash).toBe(VALID_ROOT_HASH);
  });
});

describe("resolveProof — error paths", () => {
  it("400 INVALID_TOKEN_ID for a non-numeric tokenId", async () => {
    await expect(resolveProof("abc")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_TOKEN_ID",
    });
  });

  it("404 TOKEN_NOT_FOUND when AgenticID reverts with 'Token does not exist'", async () => {
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockRejectedValue(
      new Error("call revert: Token does not exist"),
    );
    await expect(resolveProof("99")).rejects.toMatchObject({
      status: 404,
      code: "TOKEN_NOT_FOUND",
    });
  });

  it("404 NO_EXEC_LOG_ANCHOR when the token has metadata but no exec-log entry", async () => {
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockResolvedValue([
      { dataDescription: "agent_name", dataHash: `0x${"1".repeat(64)}` },
    ] as never);
    await expect(resolveProof("3")).rejects.toMatchObject({
      status: 404,
      code: "NO_EXEC_LOG_ANCHOR",
    });
  });

  it("422 SESSION_ID_MISMATCH when blob's sessionId differs from the dataDescription", async () => {
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockResolvedValue([
      {
        dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
        dataHash: VALID_ROOT_HASH,
      },
    ] as never);
    vi.spyOn(StorageClient.prototype as never, "download").mockResolvedValue(
      makeSessionLogBytes({ sessionId: "ses_DIFFERENT" }) as never,
    );
    await expect(resolveProof("1")).rejects.toMatchObject({
      status: 422,
      code: "SESSION_ID_MISMATCH",
    });
  });

  it("422 STORAGE_BLOB_INVALID_JSON when the storage blob isn't valid JSON", async () => {
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockResolvedValue([
      {
        dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
        dataHash: VALID_ROOT_HASH,
      },
    ] as never);
    vi.spyOn(StorageClient.prototype as never, "download").mockResolvedValue(
      new TextEncoder().encode("not json") as never,
    );
    await expect(resolveProof("1")).rejects.toBeInstanceOf(ProofResolutionError);
    await expect(resolveProof("1")).rejects.toMatchObject({
      status: 422,
      code: "STORAGE_BLOB_INVALID_JSON",
    });
  });

  it("502 STORAGE_DOWNLOAD_FAILED on storage transport failure", async () => {
    vi.spyOn(AgenticIDClient.prototype as never, "getIntelligentDatas").mockResolvedValue([
      {
        dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`,
        dataHash: VALID_ROOT_HASH,
      },
    ] as never);
    vi.spyOn(StorageClient.prototype as never, "download").mockRejectedValue(
      new Error("indexer 503: service unavailable"),
    );
    await expect(resolveProof("1")).rejects.toMatchObject({
      status: 502,
      code: "STORAGE_DOWNLOAD_FAILED",
    });
  });
});
