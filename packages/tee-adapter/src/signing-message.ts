/**
 * Pure helper that reconstructs the exact message agent-wrapper signs for
 * every proxied response.
 *
 * Source of truth (verified during the outwards audit by reading the
 * upstream Go implementation):
 *
 *   agent-wrapper/internal/proxy/proxy.go signResponse():
 *     content = fmt.Sprintf("%s|%s|%d|%s",
 *       agentId, sealId, timestamp, hex.EncodeToString(sha256.Sum256(body))
 *     )
 *
 *   agent-wrapper/internal/sealed/state.go SignWithAgentSealKey():
 *     hash = keccak256(content)              // raw, NOT EIP-191 prefixed
 *     sig  = ECDSA.sign(hash, key)           // 65-byte R||S||V, V=27|28
 *
 * Note the body-hash convention: lowercase hex without 0x prefix, matching
 * Go's `hex.EncodeToString(sha256.Sum256(body))` exactly. Any drift here
 * produces a silently-wrong dataHash and the verifier returns false.
 *
 * Reproduced + round-trip-tested in scripts/smoke/tee-headers.ts.
 */

import { keccak256, sha256, toUtf8Bytes } from "ethers";

export interface SigningMessageInput {
  /** X-Agent-Id from the attestation; agent-wrapper writes it as a hex string. */
  agentId: string;
  /** X-Seal-Id from the attestation. */
  sealId: string;
  /** X-Timestamp from the attestation (Unix seconds, integer). */
  timestamp: number;
  /** Response body the agent-wrapper signed. May be string or bytes. */
  body: string | Uint8Array;
}

/**
 * Reconstruct the pipe-delimited signing message exactly as agent-wrapper
 * formats it. The output is the string that gets keccak256-hashed and
 * passed to TEEVerifier.verifyTEESignature.
 */
export function reconstructSigningMessage(input: SigningMessageInput): string {
  const bodyBytes =
    typeof input.body === "string"
      ? new TextEncoder().encode(input.body)
      : input.body;
  // ethers.sha256 returns a 0x-prefixed lowercase hex string. agent-wrapper
  // writes the SAME bytes WITHOUT a 0x prefix (Go's hex.EncodeToString),
  // so we strip the leading "0x" before joining.
  const bodyHashHex = sha256(bodyBytes).slice(2);
  return `${input.agentId}|${input.sealId}|${input.timestamp}|${bodyHashHex}`;
}

/**
 * Convenience: returns the keccak256 digest of the signing message as a
 * 0x-prefixed bytes32 hex string. This is the value passed as the first
 * argument to TEEVerifier.verifyTEESignature(bytes32, bytes).
 */
export function signingMessageDigest(input: SigningMessageInput): string {
  return signingMessageDigestFromString(reconstructSigningMessage(input));
}

export function signingMessageDigestFromString(message: string): string {
  return keccak256(toUtf8Bytes(message));
}
