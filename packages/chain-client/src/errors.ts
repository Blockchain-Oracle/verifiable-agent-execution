/**
 * Structured errors for the chain-client package. Each carries a `code`
 * so call sites can branch without string-matching.
 */

export class ChainClientError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "ChainClientError";
    this.code = code;
    this.cause = cause;
  }
}

/** A required input to AgenticIDClient was malformed (address, hash, etc.). */
export class AgenticIDInputError extends ChainClientError {
  constructor(message: string) {
    super("AGENTICID_INPUT", message);
    this.name = "AgenticIDInputError";
  }
}

/**
 * The mint transaction reverted, was rejected, or its receipt couldn't be
 * fetched. Wraps the underlying ethers error so callers can branch on
 * code without string-matching.
 */
export class AgenticIDMintError extends ChainClientError {
  constructor(message: string, cause?: unknown) {
    super("AGENTICID_MINT_FAILED", message, cause);
    this.name = "AgenticIDMintError";
  }
}

/**
 * The mint succeeded on chain but the IntelligentDataSet event was not
 * present in the receipt — meaning the tokenId can't be reliably parsed.
 * Distinct from a transport-level failure.
 */
export class AgenticIDMintEventMissingError extends ChainClientError {
  constructor(message: string) {
    super("AGENTICID_MINT_EVENT_MISSING", message);
    this.name = "AgenticIDMintEventMissingError";
  }
}

/**
 * The IntelligentDataSet event was present in the receipt with a tokenId,
 * but the event's `data` payload does NOT match the IntelligentData[]
 * that was minted. The BDD says the event "confirms the data anchor" —
 * accepting just any event with the right tokenId would let a contract
 * bug or reordered receipt pass an unrelated mint as ours. (Codex round
 * 6 on PR #19.)
 */
export class AgenticIDMintEventDataMismatchError extends ChainClientError {
  constructor(message: string) {
    super("AGENTICID_MINT_EVENT_DATA_MISMATCH", message);
    this.name = "AgenticIDMintEventDataMismatchError";
  }
}

/** A read call to AgenticID failed at the transport / RPC layer. */
export class AgenticIDReadError extends ChainClientError {
  constructor(message: string, cause?: unknown) {
    super("AGENTICID_READ_FAILED", message, cause);
    this.name = "AgenticIDReadError";
  }
}

/**
 * SessionAnchor input validation, sessionId mismatch between SessionAnchor
 * and the bound SessionLogger, or any structural problem before the
 * flush+mint sequence begins. (Distinct from underlying flush/mint
 * failures, which surface as the SessionLogger or AgenticID errors above.)
 */
export class SessionAnchorError extends ChainClientError {
  constructor(message: string, cause?: unknown) {
    super("SESSION_ANCHOR", message, cause);
    this.name = "SessionAnchorError";
  }
}

/**
 * Mint failed AFTER a successful flush — the log is uploaded to 0G
 * Storage but the on-chain anchor was not created. The SessionLogger
 * is now sealed (flushed=true), so calling `anchor()` again would
 * throw ALREADY_FLUSHED. Caller must retry via `SessionAnchor.retryMint(...)`
 * (or call `AgenticIDClient.mint(...)` directly) using the `rootHash`
 * exposed on this error. (Codex round 8 on PR #19.)
 *
 * Carries enough context for either recovery path:
 *   - `rootHash`        — feed back into retryMint() / mint()
 *   - `entryCount`      — for the AnchorResult on retry
 *   - `sessionId`       — the bound session identifier
 *   - `dataDescription` — the ADR-08 string ("exec-log:<sessionId>:<modelId>")
 *                          so the caller doesn't have to reconstruct it
 *   - `cause`           — the underlying mint error (for diagnostics)
 */
export class SessionAnchorMintAfterFlushError extends ChainClientError {
  readonly rootHash: string;
  readonly entryCount: number;
  readonly sessionId: string;
  readonly dataDescription: string;
  /**
   * The prefix portion of `dataDescription` (everything before the
   * first `:<sessionId>:<modelId>` tail). v0.3.4: anchors fired from
   * `session_end` orphan-recovery use the prefix `"exec-log-orphan"`
   * instead of the default `"exec-log"`. Callers that drive
   * `retryMint()` after this error MUST pass this prefix back so the
   * retry preserves the original on-chain dataDescription identity
   * (a retry under `exec-log:` for an orphan run would split the
   * audit trail across two prefixes).
   */
  readonly dataDescriptionPrefix: string;

  constructor(opts: {
    rootHash: string;
    entryCount: number;
    sessionId: string;
    dataDescription: string;
    dataDescriptionPrefix: string;
    cause: unknown;
  }) {
    super(
      "SESSION_ANCHOR_MINT_AFTER_FLUSH",
      `Mint failed AFTER successful flush of session ${opts.sessionId}. ` +
        `The log is uploaded to 0G Storage with rootHash ${opts.rootHash} ` +
        `(${opts.entryCount} entries) but the on-chain anchor was NOT created. ` +
        `The SessionLogger is now sealed — DO NOT call anchor() again. ` +
        `Recover by calling sessionAnchor.retryMint({rootHash, entryCount, sessionId, dataDescriptionPrefix: "${opts.dataDescriptionPrefix}"}) ` +
        `or directly via agenticIdClient.mint(agentId, [{dataDescription: ` +
        `"${opts.dataDescription}", dataHash: "${opts.rootHash}"}]). ` +
        `Underlying cause: ${opts.cause instanceof Error ? opts.cause.message : String(opts.cause)}`,
      opts.cause,
    );
    this.name = "SessionAnchorMintAfterFlushError";
    this.rootHash = opts.rootHash;
    this.entryCount = opts.entryCount;
    this.sessionId = opts.sessionId;
    this.dataDescription = opts.dataDescription;
    this.dataDescriptionPrefix = opts.dataDescriptionPrefix;
  }
}
