/**
 * StorageClient — thin wrapper over @0gfoundation/0g-storage-ts-sdk.
 *
 * Source of truth (verified by scripts/smoke/storage.ts and the outwards
 * audit at context/REFERENCE_REPO_AUDIT.md):
 *   - Reference impl: 0gfoundation/0g-storage-ts-starter-kit/src/storage.ts
 *   - Patterns doc:  0gfoundation/0g-agent-skills/patterns/STORAGE.md
 *   - Network config: 0gfoundation/0g-agent-skills/patterns/NETWORK_CONFIG.md
 *
 * Important conventions baked into this client:
 *
 *   1. The SDK uses Go-style `[result, err]` tuples — NOT throws. We
 *      destructure both and throw on `err !== null` ourselves so call
 *      sites get a normal try/catch flow (and structured error classes).
 *
 *   2. `MerkleTree.rootHash()` returns `string | null`. Treat `null` as
 *      a failure mode (StorageRootHashError) rather than coercing.
 *
 *   3. Buffers go via `MemData`, not `ZgFile.fromFilePath`. ZgFile is
 *      filesystem-only; MemData is the canonical buffer path.
 *
 *   4. Verified downloads only — pass `proof: true` to
 *      `indexer.downloadToBlob` so the Merkle proof is checked.
 */

import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import type { Signer } from "ethers";

import {
  StorageDownloadError,
  StorageRootHashError,
  StorageUploadError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface StorageClientConfig {
  /** EVM RPC URL — Galileo: `https://evmrpc-testnet.0g.ai`, mainnet: `https://evmrpc.0g.ai`. */
  rpcUrl: string;
  /** 0G Storage indexer URL — e.g. `https://indexer-storage-testnet-turbo.0g.ai`. */
  indexerUrl: string;
  /** ethers v6 Signer that can pay the upload tx. */
  signer: Signer;
  /**
   * Optional pre-built Indexer (for unit tests that inject a test double
   * over the SDK surface). In production, omit this and the client
   * builds `new Indexer(indexerUrl)`.
   */
  indexer?: IndexerLike;
}

export interface UploadResult {
  /** bytes32 hex (66 chars, 0x-prefixed) — the Merkle root of the uploaded blob. */
  rootHash: string;
  /** Primary transaction hash for the upload. */
  txHash: string;
  /** SDK's internal sequence number. */
  txSeq: number;
}

/**
 * Subset of the Indexer surface this client uses. Tests substitute
 * a test double matching this shape without standing up the full SDK.
 */
export interface IndexerLike {
  upload: Indexer["upload"];
  downloadToBlob: Indexer["downloadToBlob"];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class StorageClient {
  private readonly rpcUrl: string;
  private readonly signer: Signer;
  private readonly indexer: IndexerLike;

  constructor(config: StorageClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.signer = config.signer;
    this.indexer = config.indexer ?? new Indexer(config.indexerUrl);
  }

  /**
   * Upload a buffer to 0G Storage as a `MemData` blob and return the
   * resulting `{rootHash, txHash, txSeq}`. Throws StorageUploadError on
   * SDK error and StorageRootHashError if the Merkle root computes to
   * null.
   */
  async upload(buffer: Uint8Array): Promise<UploadResult> {
    const memData = new MemData(buffer);

    // The SDK's signer parameter typing has known ESM/CJS drift between
    // ethers and the SDK; runtime-compatible. The starter kit at
    // `0g-storage-ts-starter-kit/src/storage.ts:121` uses the same cast.
    const [result, err] = await this.indexer.upload(
      memData,
      this.rpcUrl,
      this.signer as Parameters<IndexerLike["upload"]>[2],
    );

    if (err !== null) {
      throw new StorageUploadError(`Upload failed: ${err.message}`, err);
    }

    // Single-tx response: { txHash, rootHash, txSeq }.
    // Fragmented response: { txHashes[], rootHashes[], txSeqs[] }. We
    // return the first chunk's identifiers; the full set isn't needed
    // for downstream consumers (the rootHash anchors the entire log).
    if ("rootHash" in result) {
      if (result.rootHash === null) {
        throw new StorageRootHashError(
          "Upload succeeded but rootHash was null — SDK returned a degenerate result",
        );
      }
      return {
        rootHash: result.rootHash,
        txHash: result.txHash,
        txSeq: result.txSeq,
      };
    }

    if (result.rootHashes.length === 0) {
      throw new StorageRootHashError(
        "Fragmented upload succeeded but rootHashes array was empty",
      );
    }
    const rootHash = result.rootHashes[0];
    const txHash = result.txHashes[0];
    const txSeq = result.txSeqs[0];
    if (rootHash === null || rootHash === undefined) {
      throw new StorageRootHashError(
        "Fragmented upload's first rootHash was null",
      );
    }
    return { rootHash, txHash: txHash ?? "", txSeq: txSeq ?? 0 };
  }

  /**
   * Download a blob from 0G Storage by its rootHash. Returns the bytes
   * verified against the Merkle proof. Throws StorageDownloadError on
   * any failure (SDK err, blob conversion).
   */
  async download(rootHash: string): Promise<Uint8Array> {
    let result: Awaited<ReturnType<IndexerLike["downloadToBlob"]>>;
    try {
      result = await this.indexer.downloadToBlob(rootHash, { proof: true });
    } catch (cause) {
      throw new StorageDownloadError(
        `downloadToBlob threw for rootHash=${rootHash}`,
        cause,
      );
    }

    const [blob, err] = result;
    if (err !== null) {
      throw new StorageDownloadError(
        `Download failed for rootHash=${rootHash}: ${err.message}`,
        err,
      );
    }

    try {
      const arrayBuffer = await blob.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (cause) {
      throw new StorageDownloadError(
        `Failed to read blob for rootHash=${rootHash}`,
        cause,
      );
    }
  }
}
