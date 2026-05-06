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
