/**
 * Tests for packages/logger/src/StorageClient.ts
 *
 * BDD acceptance from context/docs/stories/story-storage-client.md (post-audit):
 *   - imports { Indexer, MemData, ZgFile } from "@0gfoundation/0g-storage-ts-sdk"
 *   - StorageClient.upload(buffer) returns { rootHash, txHash, txSeq }
 *   - rootHash is a valid 0x-prefixed bytes32 hex (66 chars)
 *   - the SDK returns [result, err]; non-null err → StorageUploadError
 *   - MerkleTree.rootHash() returns null path → StorageRootHashError
 *   - StorageClient.download(rootHash) returns the original Uint8Array
 *
 * Strategy:
 *   - Unit tests use an injected IndexerLike mock so no testnet wallet
 *     is needed for CI. They assert the [result, err] tuple handling
 *     and the fragmented-vs-single response shape branching.
 *   - Integration test (suite skipped unless ZG_TESTNET_RPC + ZG_INDEXER_RPC
 *     + PRIVATE_KEY are all set) does a real upload+download round-trip.
 */

import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import {
  type IndexerLike,
  StorageClient,
  StorageDownloadError,
  StorageRootHashError,
  StorageUploadError,
} from "../src/index.js";

const VALID_ROOT_HASH = `0x${"a".repeat(64)}`;
const VALID_TX_HASH = `0x${"b".repeat(64)}`;
const RPC = "https://evmrpc-testnet.0g.ai";
const INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

function makeSigner(): Wallet {
  // Local-only signing key for unit tests — never sees the network here.
  return new Wallet(`0x${"1".repeat(64)}`);
}

interface MockIndexer extends IndexerLike {}

function makeMockIndexer(opts: {
  upload?: IndexerLike["upload"];
  downloadToBlob?: IndexerLike["downloadToBlob"];
}): MockIndexer {
  return {
    upload:
      opts.upload ??
      (async () => {
        throw new Error("upload not configured for this test");
      }),
    downloadToBlob:
      opts.downloadToBlob ??
      (async () => {
        throw new Error("downloadToBlob not configured for this test");
      }),
  };
}

describe("StorageClient.upload (mocked indexer)", () => {
  it("returns {rootHash, txHash, txSeq} on a single-chunk success", async () => {
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 42 },
        null,
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    const result = await client.upload(new TextEncoder().encode("hello"));

    expect(result.rootHash).toBe(VALID_ROOT_HASH);
    expect(result.txHash).toBe(VALID_TX_HASH);
    expect(result.txSeq).toBe(42);
  });

  it("rejects fragmented uploads with StorageUploadError (Codex P1 PR #17 round 2)", async () => {
    // Earlier behavior was to return the first chunk's identifiers and
    // silently drop chunks 1..N. That made large session logs
    // unrecoverable through download(rootHash) — only the first chunk
    // could be re-fetched. Now we reject explicitly so the caller can
    // either split the session or raise the segment budget.
    const indexer = makeMockIndexer({
      upload: async () => [
        {
          rootHashes: [VALID_ROOT_HASH, `0x${"f".repeat(64)}`],
          txHashes: [VALID_TX_HASH, `0x${"e".repeat(64)}`],
          txSeqs: [10, 11],
        },
        null,
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new TextEncoder().encode("big"))).rejects.toBeInstanceOf(
      StorageUploadError,
    );
    // The error message must surface the fragment count AND the literal
    // remediation phrases the BDD spec requires ("split the session" /
    // "raise the segment budget"), so operators can act without grepping
    // the SDK's logs.
    await expect(client.upload(new TextEncoder().encode("big"))).rejects.toThrow(
      /2 fragments/,
    );
    await expect(client.upload(new TextEncoder().encode("big"))).rejects.toThrow(
      /split the session/i,
    );
    await expect(client.upload(new TextEncoder().encode("big"))).rejects.toThrow(
      /raise the segment budget/i,
    );
  });

  it("throws StorageUploadError including the SDK err.message verbatim", async () => {
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 0 },
        new Error("indexer offline: shard timeout after 30s"),
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      StorageUploadError,
    );
    // The BDD says the error must INCLUDE err.message — assert the
    // verbatim substring so a future refactor can't silently lose it.
    await expect(client.upload(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /indexer offline: shard timeout after 30s/,
    );
  });

  it("throws StorageRootHashError when single-chunk rootHash is null (defense-in-depth)", async () => {
    // Defense-in-depth: in the most realistic SDK behavior a null root
    // would be reported via the `err` element (next test), but the
    // SDK's TypeScript type allows `string | null` on the result side.
    // If a degenerate (rootHash=null, err=null) tuple ever escapes the
    // SDK, our code MUST still reject it with StorageRootHashError —
    // never coerce null to "" or treat as success.
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: null as unknown as string, txHash: VALID_TX_HASH, txSeq: 0 },
        null,
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new Uint8Array([1]))).rejects.toBeInstanceOf(
      StorageRootHashError,
    );
  });

  it("throws StorageUploadError when the SDK reports a Merkle-tree error via err", async () => {
    // The realistic shape: when MerkleTree.rootHash() can't be computed,
    // the SDK populates `err` with a Merkle-tree-specific Error and the
    // result shape is incidental. Our code routes to StorageUploadError
    // (the err-non-null path) — distinct from the defense-in-depth
    // null-root path above. This keeps the two failure-mode error
    // classes legible to callers (transport vs. data-integrity).
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 0 },
        new Error("merkle tree error: insufficient leaves"),
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new Uint8Array([1]))).rejects.toBeInstanceOf(
      StorageUploadError,
    );
    await expect(client.upload(new Uint8Array([1]))).rejects.toThrow(
      /merkle tree error: insufficient leaves/,
    );
  });

  it("throws StorageRootHashError when single-chunk rootHash is non-bytes32 hex", async () => {
    // Another path into the validation: SDK's contract says rootHash
    // must match /^0x[0-9a-fA-F]{64}$/. If the SDK ever returns a
    // truncated or non-hex string, we surface that as
    // StorageRootHashError too — the on-chain anchor would be invalid.
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: "0xnotvalidhex", txHash: VALID_TX_HASH, txSeq: 0 },
        null,
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new Uint8Array([1]))).rejects.toBeInstanceOf(
      StorageRootHashError,
    );
  });

  it("throws StorageUploadError when upload exceeds the configured deadline (BDD: within 30s)", async () => {
    // BDD: "within 30 seconds it returns {...}". The default deadline
    // is 30_000ms; test uses a tiny override so the test completes
    // quickly while still exercising the timeout race.
    const indexer = makeMockIndexer({
      upload: (async () => {
        // Hang forever — the timeout race must fire instead.
        await new Promise(() => {
          /* never resolves */
        });
        return [
          { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 0 },
          null,
        ];
      }) as unknown as IndexerLike["upload"],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
      uploadTimeoutMs: 50, // 50ms keeps the unit test fast
    });

    const promise = client.upload(new Uint8Array([1, 2, 3]));
    await expect(promise).rejects.toBeInstanceOf(StorageUploadError);
    await expect(client.upload(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /50ms deadline/,
    );
  });

  it("rejects fragmented uploads with empty arrays as StorageUploadError too", async () => {
    // Edge case: fragmented response shape but with zero fragments. The
    // new policy is "any fragmented response is rejected", so an empty
    // fragmented response throws the same StorageUploadError as a
    // multi-fragment one (it cannot be the single-tx shape — the type
    // check `"rootHash" in result` discriminates on key presence).
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHashes: [], txHashes: [], txSeqs: [] },
        null,
      ],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.upload(new Uint8Array([1]))).rejects.toBeInstanceOf(
      StorageUploadError,
    );
  });
});

describe("StorageClient.download (mocked indexer)", () => {
  it("returns the bytes from a successful downloadToBlob and passes proof:true", async () => {
    // BDD: "returns a Uint8Array that, parsed as JSON, deep-equals the
    // original upload payload". Build the original payload as a real
    // object first, so we can assert structural deep-equality after
    // round-trip — not just byte-for-byte identity (which a future
    // bug like trailing-newline injection might mask).
    const originalPayload = {
      sessionId: "ses_01",
      entries: [
        { seq: 0, tool: "web_search", note: "round-trip test" },
        { seq: 1, tool: "summarize" },
      ],
      meta: { version: 1, ts: 1_700_000_000_000 },
    };
    const originalBytes = new TextEncoder().encode(JSON.stringify(originalPayload));

    // Spy on the call so we can assert the rootHash + opts the adapter
    // uses, per BDD: must call `downloadToBlob(rootHash, { proof: true })`.
    let capturedRootHash: string | undefined;
    let capturedOpts: { proof?: boolean } | undefined;
    const indexer = makeMockIndexer({
      downloadToBlob: (async (rootHash: string, opts?: { proof?: boolean }) => {
        capturedRootHash = rootHash;
        capturedOpts = opts;
        return [new Blob([originalBytes]), null];
      }) as unknown as IndexerLike["downloadToBlob"],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    const downloaded = await client.download(VALID_ROOT_HASH);
    expect(capturedRootHash).toBe(VALID_ROOT_HASH);
    expect(capturedOpts).toEqual({ proof: true });

    // Parse the returned Uint8Array as JSON and deep-equal the original
    // payload object — encodes the BDD `Then` directly. Byte-for-byte
    // match alone is not what the spec asks for.
    const roundTripped = JSON.parse(new TextDecoder().decode(downloaded)) as unknown;
    expect(roundTripped).toEqual(originalPayload);
  });

  it("throws StorageDownloadError when SDK returns err !== null", async () => {
    const indexer = makeMockIndexer({
      downloadToBlob: async () => [new Blob([]), new Error("not found")],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.download(VALID_ROOT_HASH)).rejects.toBeInstanceOf(
      StorageDownloadError,
    );
  });

  it("throws StorageDownloadError when downloadToBlob throws", async () => {
    const indexer = makeMockIndexer({
      downloadToBlob: async () => {
        throw new Error("network unreachable");
      },
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    await expect(client.download(VALID_ROOT_HASH)).rejects.toBeInstanceOf(
      StorageDownloadError,
    );
  });
});

// ---------------------------------------------------------------------------
// Integration test — runs only when env is fully set + funded wallet
// ---------------------------------------------------------------------------

const integrationEnvReady =
  Boolean(process.env.PRIVATE_KEY) &&
  Boolean(process.env.ZG_TESTNET_RPC) &&
  Boolean(process.env.ZG_INDEXER_RPC);

describe.skipIf(!integrationEnvReady)(
  "StorageClient — Galileo testnet round-trip (integration)",
  () => {
    it("uploads a buffer and downloads identical bytes", async () => {
      const { JsonRpcProvider, Wallet: EthersWallet } = await import("ethers");
      const provider = new JsonRpcProvider(process.env.ZG_TESTNET_RPC);
      const signer = new EthersWallet(process.env.PRIVATE_KEY!, provider);

      const client = new StorageClient({
        rpcUrl: process.env.ZG_TESTNET_RPC!,
        indexerUrl: process.env.ZG_INDEXER_RPC!,
        signer,
      });

      const payload = new TextEncoder().encode(
        JSON.stringify({
          smokeTest: "storage-client-integration",
          ts: Date.now(),
        }),
      );

      const upload = await client.upload(payload);
      expect(upload.rootHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);

      const downloaded = await client.download(upload.rootHash);
      expect(new TextDecoder().decode(downloaded)).toBe(
        new TextDecoder().decode(payload),
      );
    }, /* timeout */ 60_000);
  },
);
