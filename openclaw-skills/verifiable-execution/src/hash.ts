/**
 * hash.ts — sha256 hex helper for ExecutionLogEntry inputHash/outputHash.
 *
 * The logger schema (`packages/logger/src/types.ts:executionLogEntrySchema`)
 * accepts inputHash/outputHash as 64-char LOWERCASE hex with no `0x`
 * prefix — matching agent-wrapper's body-hash convention. Node's built-in
 * `crypto.createHash('sha256').digest('hex')` produces exactly that
 * format, so no normalization is required.
 *
 * Inputs are JSON-serialized before hashing so callers can pass objects,
 * arrays, primitives, or strings without each call site doing the
 * stringify themselves. JSON.stringify(undefined) returns undefined,
 * which would crash crypto.update — we coerce to the literal string
 * "undefined" so undefined-valued tool args/results still produce a
 * stable hash instead of throwing.
 */

import { createHash } from "node:crypto";

/**
 * Compute the sha256 hex digest of an arbitrary value. Object/array
 * inputs are JSON-serialized; primitives and strings pass through
 * String() coercion. The output is 64-char lowercase hex with no
 * 0x prefix — directly compatible with ExecutionLogEntry.inputHash /
 * outputHash schemas.
 */
export function sha256Hex(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value === undefined
        ? "undefined"
        : JSON.stringify(value);
  // After the undefined-coerce, JSON.stringify can still return
  // undefined for symbol-keyed-only objects or functions. Fall back
  // to String(value) so the hash stays computable.
  const safeText = text === undefined ? String(value) : text;
  return createHash("sha256").update(safeText, "utf8").digest("hex");
}
