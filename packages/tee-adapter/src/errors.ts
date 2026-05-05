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
