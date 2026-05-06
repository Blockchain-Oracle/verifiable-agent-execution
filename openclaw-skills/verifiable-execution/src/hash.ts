/**
 * hash.ts — sha256 hex helper for ExecutionLogEntry inputHash/outputHash.
 *
 * The logger schema (`packages/logger/src/types.ts:executionLogEntrySchema`)
 * accepts inputHash/outputHash as 64-char LOWERCASE hex with no `0x`
 * prefix — matching agent-wrapper's body-hash convention. Node's built-in
 * `crypto.createHash('sha256').digest('hex')` produces exactly that
 * format, so no normalization is required.
 *
 * Contract per story-skill-intercept BDD:
 *
 *   inputHash  = sha256(JSON.stringify(input))
 *   outputHash = sha256(JSON.stringify(output))
 *
 * We honor JSON.stringify EVEN for string primitives — `JSON.stringify("abc")`
 * yields `"\"abc\""` (5 bytes) which hashes differently than the raw `abc`
 * (3 bytes). A previous version had a string fast-path that diverged from
 * the BDD; Codex round-1 on Epic 4 caught it. The BDD wins — this helper
 * is a strict alias for `sha256(JSON.stringify(value))`.
 *
 * Failure guarding: `JSON.stringify` can throw (BigInt, circular references)
 * OR return `undefined` (top-level undefined, function, symbol). Both
 * cases are real for tool args/results. We catch + coerce to a deterministic
 * fallback `<<unserializable:T>>` where T is the value's type tag, so:
 *   - The handler never crashes on weird input
 *   - Different unserializable inputs of the same type collide on the
 *     hash (acceptable trade-off — the BDD's verification path treats
 *     hashes as opaque integrity tokens, not addressable identities)
 *   - The hash is stable across runs for the same input shape
 */

import { createHash } from "node:crypto";

/**
 * Compute the sha256 hex digest of `JSON.stringify(value)`. The output
 * is 64-char lowercase hex with no 0x prefix — directly compatible with
 * ExecutionLogEntry.inputHash / outputHash schemas.
 *
 * Never throws. On serialization failure (BigInt, circular reference,
 * etc.) or undefined-yielding inputs (top-level undefined, function,
 * symbol), falls back to a deterministic `<<unserializable:T>>` sentinel
 * keyed on the input type tag.
 */
export function sha256Hex(value: unknown): string {
  let serialized: string;
  try {
    const stringified = JSON.stringify(value);
    serialized =
      stringified === undefined
        ? `<<unserializable:${describeType(value)}>>`
        : stringified;
  } catch {
    // BigInt, circular reference, or any other JSON.stringify failure.
    // Fall back to a typed sentinel so the hash is deterministic for
    // the same failure class — and the appendEntry call site is never
    // crashed by a misbehaving tool args/results.
    serialized = `<<unserializable:${describeType(value)}>>`;
  }
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

/**
 * Return a stable type tag for fallback serialization. Distinguishes
 * the common JSON.stringify failure modes (bigint, function, symbol)
 * from "circular reference of type T" — which still get a sensible
 * tag from typeof.
 */
function describeType(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "object") return "object";
  return t;
}
