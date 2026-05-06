/**
 * Execution log types + Zod schemas for verifiable-agent-execution.
 *
 * Source of truth: context/docs/architecture.md §"Execution log JSON schema".
 * The shape here MUST match what:
 *   - the OpenClaw plugin appends per tool call (Epic 4)
 *   - 0G Storage round-trips as a JSON blob (Epic 1 — StorageClient)
 *   - the verifier dashboard renders (Epic 5)
 *
 * agent-wrapper TEE-signature fields come from the X-* response headers
 * (X-Agent-Id, X-Seal-Id, X-Signature, X-Timestamp) per ADR-07. They are
 * optional on a log entry because not every entry corresponds to an
 * inference call — some are pure tool dispatches whose body is signed by
 * the same wrapper but only ECDSA-validated for inference rows in the
 * dashboard's verify pass.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive guards — bytes32 hex (66 chars, 0x-prefixed)
// ---------------------------------------------------------------------------

/** 32-byte hash, lowercase or mixed hex, with a 0x prefix. 66 chars total. */
export const bytes32HexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u, "must be 0x-prefixed 64-char hex (32 bytes)");

/** Ethereum address — 42 chars, 0x-prefixed. */
export const addressHexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u, "must be 0x-prefixed 40-char hex (20 bytes)");

/**
 * agent-wrapper writes the X-Signature header as 130 hex chars (65 bytes
 * incl. v, no 0x prefix per the upstream Go code in
 * `0gfoundation/agent-wrapper/internal/sealed/state.go:420`). Our parser
 * (Epic 2 HeaderParser) normalizes it to a 0x-prefixed 132-char string
 * before storing on the log entry, so the schema accepts that normalized
 * form.
 */
export const ecdsaSignature65Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/u, "must be 0x-prefixed 130-char hex (65 bytes incl. v)");

// ---------------------------------------------------------------------------
// ExecutionLogEntry — one row per tool call / inference / lifecycle event
// ---------------------------------------------------------------------------

export const executionLogEntryTypeSchema = z.enum([
  "tool_call",
  "inference",
  "session_start",
  "session_end",
]);

export type ExecutionLogEntryType = z.infer<typeof executionLogEntryTypeSchema>;

export const executionLogEntrySchema = z.object({
  /** 0-indexed, monotonically increasing position within the session. */
  seq: z.number().int().nonnegative(),
  /** Unix timestamp in milliseconds. */
  ts: z.number().int().nonnegative(),
  type: executionLogEntryTypeSchema,
  /** Tool name when type === "tool_call" (e.g. "web_search"). */
  tool: z.string().min(1).optional(),
  /** Model id when type === "inference" (e.g. "claude-sonnet-4-6"). */
  modelId: z.string().min(1).optional(),
  /** sha256(input) hex (no 0x prefix) — matches agent-wrapper's body-hash convention. */
  inputHash: z.string().regex(/^[0-9a-f]{64}$/u),
  /** sha256(output) hex (no 0x prefix). */
  outputHash: z.string().regex(/^[0-9a-f]{64}$/u),
  /** X-Signature header (normalized to 0x-prefixed) — present when agent-wrapper signed the response. */
  teeSignature: ecdsaSignature65Schema.optional(),
  /** Recovered signer address; expected = TEEVerifier.teeOracleAddress() (`0x04581d…`). */
  teeSigningAddress: addressHexSchema.optional(),
  /** X-Agent-Id header. */
  agentId: addressHexSchema.optional(),
  /** X-Seal-Id header — 32-byte hex. */
  sealId: bytes32HexSchema.optional(),
  /** X-Timestamp header (Unix seconds) — part of the signing payload. */
  signedAt: z.number().int().nonnegative().optional(),
});

export type ExecutionLogEntry = z.infer<typeof executionLogEntrySchema>;

// ---------------------------------------------------------------------------
// SessionLog — the JSON blob persisted to 0G Storage at session end
// ---------------------------------------------------------------------------

export const sessionLogSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative(),
    agentId: addressHexSchema,
    /** TEE container image hash (IMAGE_HASH env var inside agent-wrapper). */
    containerHash: bytes32HexSchema,
    modelId: z.string().min(1),
    entries: z.array(executionLogEntrySchema),
    entryCount: z.number().int().nonnegative(),
  })
  .refine((log) => log.entries.length === log.entryCount, {
    message: "entryCount must equal entries.length",
    path: ["entryCount"],
  })
  .refine((log) => log.endedAt >= log.startedAt, {
    message: "endedAt must be >= startedAt",
    path: ["endedAt"],
  })
  .refine(
    (log) => log.entries.every((entry, idx) => entry.seq === idx),
    {
      message: "entries must be 0-indexed contiguous by seq",
      path: ["entries"],
    },
  );

export type SessionLog = z.infer<typeof sessionLogSchema>;

// ---------------------------------------------------------------------------
// LogFlushResult — what StorageClient.upload(...) returns to the caller
// ---------------------------------------------------------------------------

export const logFlushResultSchema = z.object({
  rootHash: bytes32HexSchema,
  entryCount: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
});

export type LogFlushResult = z.infer<typeof logFlushResultSchema>;
