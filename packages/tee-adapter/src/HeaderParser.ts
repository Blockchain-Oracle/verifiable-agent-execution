/**
 * HeaderParser — extract the four signature headers that agent-wrapper
 * sets on every proxied response and produce a typed AgentWrapperAttestation.
 *
 * Source of truth (verified by reading upstream Go source during the
 * outwards audit + reproducing the protocol in scripts/smoke/tee-headers.ts):
 *
 *   - 0gfoundation/agent-wrapper/internal/proxy/proxy.go (signResponse):
 *       w.Header().Set("X-Agent-Id",   p.sealedState.GetAgentID());
 *       w.Header().Set("X-Seal-Id",    p.sealedState.GetSealID());
 *       w.Header().Set("X-Signature",  hex.EncodeToString(signature));
 *       w.Header().Set("X-Timestamp",  fmt.Sprintf("%d", timestamp));
 *
 *   - 0gfoundation/agent-wrapper/docs/api.md §"Signature Format":
 *       X-Signature is hex-encoded ECDSA, 130 hex chars (65 bytes incl. v),
 *       no 0x prefix. We normalize to 0x-prefixed inside this parser so
 *       downstream `ethers.getBytes(sig)` works without callers knowing
 *       about the upstream convention.
 *
 *   - 0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol:
 *       require(signature.length == 65, "Invalid signature length");
 *       => we validate the byte-decoded length here so wrong-shape
 *       signatures fail at parse time (cheap) instead of at chain call
 *       time (expensive RPC round-trip).
 *
 * Why parse `ZG-Res-Key` is NOT in here:
 *   ZG-Res-Key carries a chatID string (verified off-chain via
 *   `broker.inference.processResponse(addr, chatID)`), not a raw
 *   signature. It is the ADR-07 fallback path; the primary on-chain
 *   verification path uses these X-* headers. See architecture.md
 *   ADR-07 and context/REFERENCE_REPO_AUDIT.md F2/F5.
 */

import { z } from "zod";

import {
  AgentWrapperHeaderFormatError,
  AgentWrapperHeaderMissingError,
  AgentWrapperSignatureLengthError,
  AgentWrapperTimestampFormatError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentWrapperAttestation {
  /** X-Agent-Id — agent identifier, hex-encoded address (20 bytes). */
  agentId: string;
  /** X-Seal-Id — seal identifier, 32-byte hex (64 chars + 0x prefix). */
  sealId: string;
  /**
   * X-Signature — ECDSA signature, normalized to 0x-prefixed 132-char
   * hex (65 bytes incl. v=27|28). The wire format from agent-wrapper
   * lacks the 0x prefix; this parser adds it so `ethers.getBytes(sig)`
   * decodes cleanly.
   */
  signature: string;
  /** X-Timestamp — Unix seconds, parsed from the header's base-10 string. */
  timestamp: number;
}

const HEX_NO_PREFIX_130 = /^[0-9a-fA-F]{130}$/u;
const HEX_PREFIX_64 = /^0x[0-9a-fA-F]{64}$/u;
const HEX_PREFIX_40 = /^0x[0-9a-fA-F]{40}$/u;
const HEX_PREFIX_130 = /^0x[0-9a-fA-F]{130}$/u;
const UINT_BASE10 = /^[0-9]+$/u;

// ---------------------------------------------------------------------------
// Helpers — normalize on the way in so downstream consumers never have
// to know about the no-0x-prefix wire convention. The internal validation
// schema runs against the normalized form.
// ---------------------------------------------------------------------------

const attestationSchema = z.object({
  agentId: z.string().regex(HEX_PREFIX_40),
  sealId: z.string().regex(HEX_PREFIX_64),
  signature: z.string().regex(HEX_PREFIX_130),
  timestamp: z.number().int().nonnegative(),
});

function require_(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) {
    throw new AgentWrapperHeaderMissingError(name);
  }
  return value;
}

/**
 * Normalize + validate the agent identifier. Throws AgentWrapperHeaderFormatError
 * (NOT HeaderMissingError) when the header was present but malformed —
 * Codex P2 on PR #18 flagged that the prior code conflated these two
 * distinct failure modes.
 */
function normalizeAgentId(raw: string): string {
  const candidate =
    raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  if (!HEX_PREFIX_40.test(candidate)) {
    throw new AgentWrapperHeaderFormatError(
      "X-Agent-Id",
      `expected 0x-prefixed 40-char hex (20 bytes); got ${raw.length} chars: ${truncateForError(raw)}`,
    );
  }
  return candidate;
}

function normalizeSealId(raw: string): string {
  const candidate =
    raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  if (!HEX_PREFIX_64.test(candidate)) {
    throw new AgentWrapperHeaderFormatError(
      "X-Seal-Id",
      `expected 0x-prefixed 64-char hex (32 bytes); got ${raw.length} chars: ${truncateForError(raw)}`,
    );
  }
  return candidate;
}

function truncateForError(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function normalizeSignature(raw: string): string {
  // agent-wrapper writes hex without 0x prefix per the upstream Go code
  // (sealed/state.go:420). Some clients prepend 0x defensively. Accept
  // both, normalize to 0x-prefixed.
  const stripped = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!HEX_NO_PREFIX_130.test(stripped)) {
    // Compute byte length from raw hex chars for the error message; if
    // the string is non-hex, byteLength is reported as 0 (so the caller
    // sees "got 0" and can grep for non-hex input separately).
    const byteLength = /^[0-9a-fA-F]*$/u.test(stripped)
      ? stripped.length / 2
      : 0;
    throw new AgentWrapperSignatureLengthError(byteLength);
  }
  return `0x${stripped}`;
}

function parseTimestamp(raw: string): number {
  if (!UINT_BASE10.test(raw)) {
    throw new AgentWrapperTimestampFormatError(raw);
  }
  // Number-parse after the regex guard so we know it's safe.
  return Number.parseInt(raw, 10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const HeaderParser = {
  /**
   * Parse the four agent-wrapper signature headers from a Headers object.
   *
   * Throws (subclasses of TEEAdapterError):
   *   - AgentWrapperHeaderMissingError(headerName) if any of the four is absent
   *   - AgentWrapperHeaderFormatError(headerName, reason) if agentId/sealId
   *     is present but malformed
   *   - AgentWrapperSignatureLengthError(actualBytes) if signature ≠ 65 bytes
   *   - AgentWrapperTimestampFormatError(raw) if timestamp is not base-10 uint
   *
   * On success, the returned signature is 0x-prefixed regardless of the
   * wire format the server used.
   */
  parse(headers: Headers): AgentWrapperAttestation {
    const agentIdRaw = require_(headers, "X-Agent-Id");
    const sealIdRaw = require_(headers, "X-Seal-Id");
    const signatureRaw = require_(headers, "X-Signature");
    const timestampRaw = require_(headers, "X-Timestamp");

    const attestation: AgentWrapperAttestation = {
      agentId: normalizeAgentId(agentIdRaw),
      sealId: normalizeSealId(sealIdRaw),
      signature: normalizeSignature(signatureRaw),
      timestamp: parseTimestamp(timestampRaw),
    };

    // Final shape check — defense in depth. With the per-field validators
    // above (which throw the correct typed errors), this branch should
    // be unreachable. If it ever fires (e.g. someone bypasses the
    // helpers), surface as a FORMAT error (not MISSING) so caller
    // diagnostics stay accurate. Closes Codex P2 on PR #18.
    const result = attestationSchema.safeParse(attestation);
    if (!result.success) {
      const issue = result.error.issues[0];
      const fieldToHeader: Record<string, string> = {
        agentId: "X-Agent-Id",
        sealId: "X-Seal-Id",
        signature: "X-Signature",
        timestamp: "X-Timestamp",
      };
      const fieldKey = issue?.path[0]?.toString() ?? "unknown";
      throw new AgentWrapperHeaderFormatError(
        fieldToHeader[fieldKey] ?? fieldKey,
        issue?.message ?? "schema validation failed",
      );
    }
    return result.data;
  },
};

export type { AgentWrapperAttestation as AgentWrapperAttestationType };
