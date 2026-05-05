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

  it("returns first-chunk identifiers on a fragmented upload", async () => {
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

    const result = await client.upload(new TextEncoder().encode("big"));

    expect(result.rootHash).toBe(VALID_ROOT_HASH);
    expect(result.txHash).toBe(VALID_TX_HASH);
    expect(result.txSeq).toBe(10);
  });

  it("throws StorageUploadError when SDK returns err !== null", async () => {
    const indexer = makeMockIndexer({
      upload: async () => [
        { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 0 },
        new Error("indexer offline"),
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
  });

  it("throws StorageRootHashError when single-chunk rootHash is null", async () => {
    const indexer = makeMockIndexer({
      upload: async () => [
        // Cast: the SDK's runtime can produce null even though the type
        // says string; this is exactly the case the audit caught.
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

  it("throws StorageRootHashError when fragmented rootHashes array is empty", async () => {
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
      StorageRootHashError,
    );
  });
});

describe("StorageClient.download (mocked indexer)", () => {
  it("returns the bytes from a successful downloadToBlob", async () => {
    const original = new TextEncoder().encode(
      JSON.stringify({ sessionId: "ses_01", entries: [] }),
    );
    const indexer = makeMockIndexer({
      downloadToBlob: async () => [new Blob([original]), null],
    });
    const client = new StorageClient({
      rpcUrl: RPC,
      indexerUrl: INDEXER_URL,
      signer: makeSigner(),
      indexer,
    });

    const downloaded = await client.download(VALID_ROOT_HASH);
    expect(new TextDecoder().decode(downloaded)).toBe(
      new TextDecoder().decode(original),
    );
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
