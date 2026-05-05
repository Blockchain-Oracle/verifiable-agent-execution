export { HeaderParser } from "./HeaderParser.js";
export type { AgentWrapperAttestation } from "./HeaderParser.js";

export {
  reconstructSigningMessage,
  signingMessageDigest,
  signingMessageDigestFromString,
} from "./signing-message.js";
export type { SigningMessageInput } from "./signing-message.js";

export { TEEProofAdapter } from "./TEEProofAdapter.js";
export type {
  TEEProofAdapterConfig,
  TEEVerifyResult,
  VerifierLike,
} from "./TEEProofAdapter.js";

export {
  AgentWrapperHeaderFormatError,
  AgentWrapperHeaderMissingError,
  AgentWrapperSignatureLengthError,
  AgentWrapperTimestampFormatError,
  TEEAdapterError,
  VerifierCallError,
} from "./errors.js";
