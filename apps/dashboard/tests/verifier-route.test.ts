/**
 * Tests for apps/dashboard/src/app/api/verify/[tokenId]/route.ts.
 *
 * BDD acceptance from context/docs/stories/story-verifier-api.md:
 *   - GET /api/verify/42 returns HTTP 200 + JSON body with the
 *     {tokenId, sessionId, rootHash, entryCount, verified, entries[]}
 *     shape
 *   - GET /api/verify/<nonexistent> returns HTTP 404 + machine-readable
 *     error code in the body
 *
 * Strategy: import the route's `GET` export directly and invoke it
 * with a synthetic Request + params context, instead of standing up a
 * Next.js dev server. This is the "HTTP route test" Codex web R1 on
 * PR #20 asked for — verifier-api.test.ts covers the resolveProof
 * library; this file covers the HTTP boundary (status codes, response
 * body shape, error envelope).
 *
 * The route's resolveProof is stubbed via the __setCachedClientsForTests
 * test seam in verify-proof.ts, NOT via vi.mock (vi.mock + Next.js
 * route handler imports interact poorly because the handler is a
 * server component evaluated at import time).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Wallet } from "ethers";

// Set required env BEFORE importing the route — env.ts validates at
// module load.
process.env.ZG_TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
process.env.ZG_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
process.env.AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
process.env.CHAIN_ID = "16602";

import { GET } from "@/app/api/verify/[tokenId]/route";
import { __setCachedClientsForTests } from "@/lib/verify-proof";

const VALID_ROOT_HASH = `0x${"a".repeat(64)}`;
const SESSION_ID = "ses_route_01";
const MODEL_ID = "claude-sonnet-4-6";

function makeSessionLogBlob(overrides: Record<string, unknown> = {}): {
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
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
        type: "tool_call",
        tool: "web_search",
        inputHash: "a".repeat(64),
        outputHash: "b".repeat(64),
      },
    ],
    entryCount: 1,
  };
  const merged = { ...base, ...overrides };
  const json = JSON.stringify(merged);
  const bytes = new TextEncoder().encode(json);
  return {
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return buf;
    },
  };
}

function installFakeClients(opts: {
  intelligentDatas?: Array<{ dataDescription: string; dataHash: string }>;
  intelligentDatasError?: Error;
  storageBlob?: ReturnType<typeof makeSessionLogBlob>;
  verifierResult?: boolean;
}): void {
  const provider = {
    getNetwork: async () => ({ chainId: 16602n }),
  };
  const agenticIdClient = {
    contractAddress: process.env.AGENTICID_ADDRESS!,
    getIntelligentDatas: async () => {
      if (opts.intelligentDatasError !== undefined) throw opts.intelligentDatasError;
      return opts.intelligentDatas ?? [];
    },
  };
  const indexer = {
    downloadToBlob: async () => {
      if (opts.storageBlob === undefined) {
        return [null, new Error("storage blob not configured for this test")];
      }
      return [opts.storageBlob, null];
    },
  };
  const verifier =
    opts.verifierResult === undefined
      ? null
      : {
          verifyTEESignature: vi.fn(async () => opts.verifierResult),
        };
  __setCachedClientsForTests({
    provider: provider as never,
    agenticIdClient: agenticIdClient as never,
    indexer: indexer as never,
    verifier: verifier as never,
    env: {
      ZG_TESTNET_RPC: process.env.ZG_TESTNET_RPC!,
      ZG_INDEXER_RPC: process.env.ZG_INDEXER_RPC!,
      AGENTICID_ADDRESS: process.env.AGENTICID_ADDRESS!,
      CHAIN_ID: 16602,
      TEE_VERIFIER_ADDRESS: opts.verifierResult === undefined ? undefined : `0x${"a".repeat(40)}`,
    },
  });
}

beforeEach(() => {
  __setCachedClientsForTests(null);
});

// Use a Wallet to suppress unused-import warnings — the import keeps
// our test bundle aligned with verify-proof's ethers dep without
// needing a separate type assertion.
void Wallet;

describe("GET /api/verify/[tokenId] — happy path", () => {
  it("returns HTTP 200 with the BDD-required body shape for a valid tokenId", async () => {
    installFakeClients({
      intelligentDatas: [
        { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
      ],
      storageBlob: makeSessionLogBlob(),
    });

    const request = new Request("http://localhost:3000/api/verify/42");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "42" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      tokenId: "42",
      sessionId: SESSION_ID,
      rootHash: VALID_ROOT_HASH,
      entryCount: 1,
      verified: "preview", // verifier not configured in this test
    });
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    expect(body.entries[0]).toMatchObject({
      tool: "web_search",
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
    });
  });
});

describe("GET /api/verify/[tokenId] — error paths", () => {
  it("returns HTTP 400 with INVALID_TOKEN_ID for a non-numeric tokenId", async () => {
    installFakeClients({});
    const request = new Request("http://localhost:3000/api/verify/abc");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "abc" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error?.code).toBe("INVALID_TOKEN_ID");
  });

  it("returns HTTP 404 with TOKEN_NOT_FOUND when the chain reverts 'Token does not exist'", async () => {
    installFakeClients({
      intelligentDatasError: new Error("call revert: Token does not exist"),
    });
    const request = new Request("http://localhost:3000/api/verify/99");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "99" }) });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe("TOKEN_NOT_FOUND");
    // BDD: "the response body includes a machine-readable error code"
    expect(typeof body.error?.code).toBe("string");
  });

  it("returns HTTP 404 with NO_EXEC_LOG_ANCHOR when the token has metadata but no exec-log entry", async () => {
    installFakeClients({
      intelligentDatas: [{ dataDescription: "agent_name", dataHash: VALID_ROOT_HASH }],
    });
    const request = new Request("http://localhost:3000/api/verify/3");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "3" }) });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe("NO_EXEC_LOG_ANCHOR");
  });

  it("returns HTTP 502 with STORAGE_DOWNLOAD_FAILED when the indexer returns an err tuple", async () => {
    installFakeClients({
      intelligentDatas: [
        { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
      ],
      // storageBlob omitted → installFakeClients returns [null, Error]
    });
    const request = new Request("http://localhost:3000/api/verify/1");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "1" }) });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error?.code).toBe("STORAGE_DOWNLOAD_FAILED");
  });

  it("returns HTTP 422 with SESSION_ID_MISMATCH when blob's sessionId differs", async () => {
    installFakeClients({
      intelligentDatas: [
        { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
      ],
      storageBlob: makeSessionLogBlob({ sessionId: "ses_DIFFERENT" }),
    });
    const request = new Request("http://localhost:3000/api/verify/1");
    const response = await GET(request, { params: Promise.resolve({ tokenId: "1" }) });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error?.code).toBe("SESSION_ID_MISMATCH");
  });
});

describe("GET /api/verify/[tokenId] — verifier integration", () => {
  it("verified='preview' when no signed entries exist (verifier configured but session unsigned)", async () => {
    installFakeClients({
      intelligentDatas: [
        { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
      ],
      storageBlob: makeSessionLogBlob(),
      verifierResult: true, // doesn't matter — no entries to call against
    });
    const response = await GET(new Request("http://localhost:3000/api/verify/1"), {
      params: Promise.resolve({ tokenId: "1" }),
    });
    const body = await response.json();
    expect(body.verified).toBe("preview");
  });
});
