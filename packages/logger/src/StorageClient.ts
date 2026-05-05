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

import { Indexer, MemData, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import type { Signer } from "ethers";

import {
  StorageDownloadError,
  StorageRootHashError,
  StorageUploadError,
} from "./errors.js";

// ZgFile is re-exported through the package barrel so callers needing
// filesystem-path uploads (post-hackathon scope) can use it without an
// extra import. Internal upload() always uses MemData (canonical buffer
// path per agent-skills/patterns/STORAGE.md). The unused-symbol guard:
void ZgFile;
const BYTES32_HEX_RE = /^0x[0-9a-fA-F]{64}$/u;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

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
  /**
   * Maximum time (ms) to wait for `indexer.upload(...)` before throwing
   * StorageUploadError. Defaults to 30_000 (30s) per BDD acceptance
   * "within 30 seconds it returns {...}". Override only for tests that
   * deliberately exercise the timeout path or for slow CI environments.
   */
  uploadTimeoutMs?: number;
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
  private readonly uploadTimeoutMs: number;

  constructor(config: StorageClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.signer = config.signer;
    this.indexer = config.indexer ?? new Indexer(config.indexerUrl);
    this.uploadTimeoutMs = config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
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
    //
    // Wrap with Promise.race against a deadline timer so a stalled
    // indexer doesn't tie up the caller indefinitely (BDD: "within 30
    // seconds it returns {...}" → throw StorageUploadError on overrun).
    const uploadPromise = this.indexer.upload(
      memData,
      this.rpcUrl,
      this.signer as Parameters<IndexerLike["upload"]>[2],
    );
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new StorageUploadError(
            `Upload exceeded ${this.uploadTimeoutMs}ms deadline (BDD bound).`,
          ),
        );
      }, this.uploadTimeoutMs);
    });
    let result: Awaited<ReturnType<IndexerLike["upload"]>>[0];
    let err: Awaited<ReturnType<IndexerLike["upload"]>>[1];
    try {
      [result, err] = await Promise.race([uploadPromise, timeoutPromise]);
    } catch (cause) {
      // The SDK's documented contract is `[result, err]` tuples, but
      // defense in depth: if `indexer.upload(...)` REJECTS (throws)
      // instead of returning the tuple, wrap as StorageUploadError so
      // callers branching on `instanceof StorageUploadError` see a
      // consistent type regardless of how the SDK reports failure.
      // (Closes Codex P1 round 3 on PR #17.) Note: the timeout-deadline
      // promise also rejects with StorageUploadError; rethrow that
      // unchanged so the deadline message is preserved.
      if (cause instanceof StorageUploadError) {
        throw cause;
      }
      throw new StorageUploadError(
        `Upload threw instead of returning [result, err]: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }

    if (err !== null) {
      throw new StorageUploadError(`Upload failed: ${err.message}`, err);
    }

    // Single-tx response: { txHash, rootHash, txSeq }.
    // Fragmented response: { txHashes[], rootHashes[], txSeqs[] }.
    if ("rootHash" in result) {
      if (result.rootHash === null) {
        throw new StorageRootHashError(
          "Upload succeeded but rootHash was null — SDK returned a degenerate result",
        );
      }
      // Validate the SDK's contract: rootHash must be a 0x-prefixed
      // bytes32 hex string. The downstream iNFT mint expects exactly
      // this shape; surface drift here so it doesn't corrupt the
      // anchor at chain-call time.
      if (!BYTES32_HEX_RE.test(result.rootHash)) {
        throw new StorageRootHashError(
          `Upload succeeded but rootHash is not a valid bytes32 hex: ${result.rootHash}`,
        );
      }
      return {
        rootHash: result.rootHash,
        txHash: result.txHash,
        txSeq: result.txSeq,
      };
    }

    // Fragmented uploads — REJECT (Codex P1 on PR #17 round 2 +
    // story-storage-client BDD updated alongside this commit).
    //
    // Earlier we silently returned the first chunk's identifiers and
    // substituted empty values for any missing tx metadata. Both were
    // wrong:
    //   (a) `download(rootHash)` only accepts a single root, so chunks
    //       1..N would be unrecoverable — the on-chain anchor would
    //       point at an unverifiable partial blob.
    //   (b) Substituting txHash="" / txSeq=0 hid an upstream data-
    //       integrity failure behind a "successful" return value,
    //       violating AGENTS.md "no swallowed errors / fail fast".
    //
    // Hackathon scope: session-log JSON blobs are well under the 0G
    // Storage segment size (~256KB), so fragmentation should never
    // happen in practice. If it does, the cleanest behavior is to
    // throw loudly so the caller can split the session OR raise the
    // segment budget. Multi-fragment download/anchor is a post-
    // hackathon scope change.
    const fragmentCount = result.rootHashes.length;
    throw new StorageUploadError(
      `Fragmented uploads are not supported (got ${fragmentCount} fragments). ` +
        "Session log payload is too large for a single 0G Storage segment; " +
        "split the session or raise the segment budget before retrying.",
    );
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
