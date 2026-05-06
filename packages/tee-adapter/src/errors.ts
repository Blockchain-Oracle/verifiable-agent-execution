/**
 * Structured errors for the tee-adapter package. Each carries a `code`
 * so call sites can branch without string-matching the message.
 */

export class TEEAdapterError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "TEEAdapterError";
    this.code = code;
    this.cause = cause;
  }
}

/** A required X-* header from agent-wrapper was absent. */
export class AgentWrapperHeaderMissingError extends TEEAdapterError {
  readonly headerName: string;
  constructor(headerName: string) {
    super(
      "AGENT_WRAPPER_HEADER_MISSING",
      `agent-wrapper response is missing required header: ${headerName}`,
    );
    this.name = "AgentWrapperHeaderMissingError";
    this.headerName = headerName;
  }
}

/**
 * A required X-* header was present but malformed (wrong length, wrong
 * character set, etc.). Distinct from `AgentWrapperHeaderMissingError`
 * so callers can branch retry/diagnostic behavior — a missing header
 * may be a deployment misconfig (caller should fail loudly), while a
 * malformed value is more likely a tampering attempt or a version
 * mismatch (caller may want to mark the entry as 'verifier_unreachable'
 * and continue).
 *
 * Closes Codex P2 on PR #18 — the prior implementation reused
 * AgentWrapperHeaderMissingError for both cases, which broke caller
 * logic that distinguishes them.
 */
export class AgentWrapperHeaderFormatError extends TEEAdapterError {
  readonly headerName: string;
  readonly reason: string;
  constructor(headerName: string, reason: string) {
    super(
      "AGENT_WRAPPER_HEADER_FORMAT",
      `agent-wrapper header ${headerName} is malformed: ${reason}`,
    );
    this.name = "AgentWrapperHeaderFormatError";
    this.headerName = headerName;
    this.reason = reason;
  }
}

/**
 * X-Signature was present but did not hex-decode to exactly 65 bytes
 * (the size TEEVerifier.verifyTEESignature requires).
 */
export class AgentWrapperSignatureLengthError extends TEEAdapterError {
  readonly actualByteLength: number;
  constructor(actualByteLength: number) {
    super(
      "AGENT_WRAPPER_SIGNATURE_LENGTH",
      `agent-wrapper X-Signature must be 65 bytes (R||S||V); got ${actualByteLength}`,
    );
    this.name = "AgentWrapperSignatureLengthError";
    this.actualByteLength = actualByteLength;
  }
}

/** X-Timestamp was not a base-10 unsigned integer. */
export class AgentWrapperTimestampFormatError extends TEEAdapterError {
  readonly raw: string;
  constructor(raw: string) {
    super(
      "AGENT_WRAPPER_TIMESTAMP_FORMAT",
      `agent-wrapper X-Timestamp must be a base-10 unsigned integer; got "${raw}"`,
    );
    this.name = "AgentWrapperTimestampFormatError";
    this.raw = raw;
  }
}

/**
 * Wraps a transport-level failure of TEEVerifier.verifyTEESignature so the
 * SessionLogger can mark the entry as 'verifier_unreachable' rather than
 * conflating it with a legitimate `valid: false` verdict. Distinct from
 * the contract returning false (a normal verification result).
 */
export class VerifierCallError extends TEEAdapterError {
  constructor(message: string, cause?: unknown) {
    super("VERIFIER_CALL_FAILED", message, cause);
    this.name = "VerifierCallError";
  }
}
