/**
 * exec-log-parser.ts — centralized parsing of the on-chain
 * `dataDescription` strings the verifiable-execution plugin mints.
 *
 * The plugin writes `dataDescription` in two flavors:
 *
 *   exec-log:<sessionId>:<modelId>          — normal agent_end anchor
 *   exec-log-orphan:<sessionId>:<modelId>   — session_end recovery
 *                                              anchor (agent_end never
 *                                              fired; bytes anchored
 *                                              so the run isn't lost)
 *
 * Previous revisions of the dashboard scattered four `startsWith(
 * "exec-log:")` filters plus one bespoke `parseSessionIdFromDescription`
 * helper across `verify-proof.ts` + `feed.ts`. Each had to be patched
 * separately for:
 *   - Codex round-4 P1 (colon-in-sessionId bug — `split(":")` truncated
 *     real VPS sessionKeys like `agent:core:telegram:direct:802…`).
 *   - v0.3.4 orphan-recovery prefix support.
 *
 * Centralizing both concerns here means the dashboard adds support
 * for any new prefix variant in one place. The parser uses
 * `lastIndexOf(":")` semantics so sessionIds containing arbitrary
 * colons round-trip cleanly.
 */

/**
 * The two prefixes the verifiable-execution plugin mints today.
 * Order matters: the longer prefix MUST be tested first so the
 * `startsWith` check doesn't classify `exec-log-orphan:` rows as
 * normal `exec-log:` rows.
 */
const KNOWN_PREFIXES = ["exec-log-orphan:", "exec-log:"] as const;

/**
 * Output shape: the parsed sessionId/modelId pair plus a boolean
 * flag indicating whether the dataDescription came from the
 * `exec-log-orphan:` (recovery) branch. The dashboard renders a
 * distinct badge when `recoveryAnchor === true`.
 */
export interface ParsedExecutionLog {
  sessionId: string;
  modelId: string;
  /** True iff the dataDescription used the `exec-log-orphan:` prefix. */
  recoveryAnchor: boolean;
}

/**
 * O(1) test for whether a dataDescription was minted by the
 * verifiable-execution plugin in any flavor. Use this to filter
 * `getIntelligentDatas()` results before downloading the blob — non-
 * matching entries belong to other plugins or hand-minted anchors and
 * the verifier dashboard ignores them.
 *
 * Defensive: returns false for non-string input (the feed walker
 * passes raw on-chain values that may have unexpected shapes during
 * an ABI mismatch — refuse to crash the walk).
 */
export function isExecutionLogDescription(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return KNOWN_PREFIXES.some((p) => value.startsWith(p));
}

/**
 * Parse `dataDescription` into its three semantic parts. Returns
 * `null` instead of throwing when the input doesn't match either
 * known prefix OR has an empty sessionId/modelId — callers (the feed
 * walker, the verifier resolver) decide whether a malformed entry is
 * an HTTP 422 or a silently-skipped row.
 *
 * Parsing rule:
 *   1. Match the longest known prefix exactly.
 *   2. modelId = the FINAL `:`-delimited segment (no colons allowed
 *      inside modelId — that's been the plugin's contract since v0.1.0).
 *   3. sessionId = everything between the prefix and that final colon
 *      (CAN contain colons; OpenClaw sessionKeys routinely do).
 *
 * Examples:
 *   "exec-log:abc:claude"
 *     → { sessionId:"abc", modelId:"claude", recoveryAnchor:false }
 *   "exec-log:agent:core:telegram:direct:802:claude-sonnet-4-6"
 *     → { sessionId:"agent:core:telegram:direct:802",
 *         modelId:"claude-sonnet-4-6", recoveryAnchor:false }
 *   "exec-log-orphan:abc:claude"
 *     → { sessionId:"abc", modelId:"claude", recoveryAnchor:true }
 */
export function parseExecutionLogDescription(
  dataDescription: string,
): ParsedExecutionLog | null {
  for (const prefix of KNOWN_PREFIXES) {
    if (!dataDescription.startsWith(prefix)) continue;
    const rest = dataDescription.slice(prefix.length);
    const lastColon = rest.lastIndexOf(":");
    // sessionId must be non-empty (lastColon > 0) and modelId must be
    // non-empty (final colon not at end of string).
    if (lastColon <= 0) return null;
    if (lastColon === rest.length - 1) return null;
    return {
      sessionId: rest.slice(0, lastColon),
      modelId: rest.slice(lastColon + 1),
      recoveryAnchor: prefix === "exec-log-orphan:",
    };
  }
  return null;
}
