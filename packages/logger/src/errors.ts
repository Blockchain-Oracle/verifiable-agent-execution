/**
 * Structured errors for the logger package. Each carries a code so call
 * sites can branch on the exact failure mode without string-matching.
 */

export class StorageClientError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "StorageClientError";
    this.code = code;
    this.cause = cause;
  }
}

/** Indexer.upload returned `[_, err]` with err !== null. */
export class StorageUploadError extends StorageClientError {
  constructor(message: string, cause?: unknown) {
    super("STORAGE_UPLOAD_FAILED", message, cause);
    this.name = "StorageUploadError";
  }
}

/** MerkleTree.rootHash() returned null — SDK type is `string | null`. */
export class StorageRootHashError extends StorageClientError {
  constructor(message: string) {
    super("STORAGE_ROOT_HASH_NULL", message);
    this.name = "StorageRootHashError";
  }
}

/** Indexer.download returned an Error or threw. */
export class StorageDownloadError extends StorageClientError {
  constructor(message: string, cause?: unknown) {
    super("STORAGE_DOWNLOAD_FAILED", message, cause);
    this.name = "StorageDownloadError";
  }
}
