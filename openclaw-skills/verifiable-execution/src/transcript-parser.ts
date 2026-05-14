/**
 * transcript-parser.ts — extract tool-call events from a Claude Code
 * session jsonl file (v0.3.5 content-fidelity capture).
 *
 * Why this exists: claude-cli runs Claude Code as a subprocess. Its
 * built-in tools (Read/WebSearch/Bash/Edit/MCP) don't route through
 * OpenClaw's tool dispatcher, so `after_tool_call` never fires. But
 * Claude Code DOES persist every tool_use/tool_result block to its
 * own jsonl at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
 * We read that file at `agent_end` time and synthesize one entry per
 * tool_use block so the receipt actually shows what the agent did.
 *
 * Confirmed real-world example (token 106's run, 2026-05-14):
 *   /root/.claude/projects/-root--openclaw-workspace-research-agent/
 *     77a24b87-b296-4780-9a0a-288c855b28e1.jsonl
 *
 *   tool_use blocks during 10:57-10:59 UTC window:
 *     Read       :: {"file_path": ".../SKILL.md"}
 *     ToolSearch :: {"query": "select:WebSearch", "max_results": 1}
 *     WebSearch  :: {"query": "Solana SOL price today May 2026"}
 *     WebSearch  :: {"query": "0G Labs latest news May 2026"}
 *
 *   …none of which appeared in token 106's receipt (entryCount=2).
 *
 * Jsonl event shape (per `~/.claude/projects/*.jsonl` inspection):
 *   - Every line is one JSON object with a top-level `timestamp` (ISO
 *     8601) and `type` field
 *   - `type: "assistant"` events carry the LLM's response in
 *     `message: { role: "assistant", content: ContentBlock[] }`
 *   - `type: "user"` events carry both genuine user messages AND
 *     tool_result blocks (Claude Code returns tool results AS user
 *     messages per Anthropic's API convention)
 *   - ContentBlock variants:
 *       { type: "text", text }
 *       { type: "thinking", thinking }
 *       { type: "tool_use", id, name, input }
 *       { type: "tool_result", tool_use_id, content }
 *
 * Filtering: callers pass `runStartTime` (ms since epoch) — we
 * include only events with `timestamp >= runStartTime`, so re-reading
 * the same jsonl on later turns doesn't double-anchor prior tools.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Output shape: each tool call captured from the transcript becomes
 * one of these objects. handleAgentEnd builds an ExecutionLogEntry
 * around it.
 */
export interface TranscriptToolCall {
  /** The block's `id` (Anthropic toolCallId — useful for dedup). */
  toolCallId: string;
  /** Tool name as called (e.g. `WebSearch`, `Read`, `mcp__brave-search__...`). */
  toolName: string;
  /** The tool_use block's `input` field — arbitrary JSON. */
  input: unknown;
  /** The matching tool_result content, if found. null when missing. */
  result: unknown;
  /** True if the tool_result block had `is_error: true`. */
  isError: boolean;
  /** Timestamp of the tool_use event (used to order entries in the log). */
  toolUseAtMs: number;
}

/**
 * Encode a workspace cwd into the directory-name shape Claude Code
 * uses under `~/.claude/projects/`. The encoding is: replace every
 * `/` with `-`, prepend a leading `-`. So `/root/.openclaw/workspace/
 * research-agent` becomes `-root--openclaw-workspace-research-agent`.
 *
 * Claude Code does the same encoding internally; we replicate it here
 * to find the project directory without depending on Claude Code's
 * resolver. This is the FALLBACK path for when
 * `before_agent_finalize` didn't provide an explicit transcriptPath
 * (Claude Code's native hooks aren't wired in `.claude/settings.json`).
 *
 * Exported for testability.
 */
export function encodeWorkspaceForClaudeProjects(workspaceDir: string): string {
  // Claude Code's encoding replaces every `/` with `-`. Absolute
  // paths starting with `/` get a leading `-`. Trailing `/` would
  // produce a trailing `-`; we strip it so the prefix is stable
  // whether the caller passes `/root/x` or `/root/x/`.
  const trimmed = workspaceDir.replace(/\/+$/, "");
  return trimmed.replace(/\//g, "-");
}

/**
 * Resolve the Claude Code session jsonl path for a workspace.
 *
 * Strategy:
 *   1. Compute the projects directory: `~/.claude/projects/<encoded>`.
 *   2. If empty/missing, return null (claude-cli wasn't used).
 *   3. Otherwise return the MOST RECENTLY MODIFIED `.jsonl` in that
 *      dir, which is the active session (Claude Code keeps one
 *      file open per session and appends to it on every turn).
 *
 * Limitations:
 *   - Multi-session: if the bot maintains multiple concurrent
 *     claude-cli sessions in the same workspace, this picks the most
 *     recently touched one. For single-session bots (our case) it's
 *     correct. Real fix is `transcriptPath` from `before_agent_finalize`.
 *
 * Exported for testability.
 */
export function resolveClaudeCliTranscriptPath(
  workspaceDir: string,
  options?: { homeDirOverride?: string },
): string | null {
  const home = options?.homeDirOverride ?? homedir();
  const projectsDir = join(
    home,
    ".claude",
    "projects",
    encodeWorkspaceForClaudeProjects(workspaceDir),
  );
  if (!existsSync(projectsDir)) return null;
  let bestPath: string | null = null;
  let bestMtime = -Infinity;
  try {
    for (const entry of readdirSync(projectsDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = join(projectsDir, entry);
      try {
        const stat = statSync(full);
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestPath = full;
        }
      } catch {
        // Per-file stat failure — skip without failing the resolver.
      }
    }
  } catch {
    return null;
  }
  return bestPath;
}

/**
 * Parse a Claude Code session jsonl and return every tool call whose
 * `tool_use` event timestamp is `>= sinceMs`. Pairs each tool_use
 * with its matching tool_result (by `tool_use_id`).
 *
 * Robust to:
 *   - The file not existing (returns []).
 *   - Mixed event types (filters to `type: "user" | "assistant"`).
 *   - Malformed lines (skips silently per-line).
 *   - tool_use without a matching tool_result (caller sees `result: null`).
 *   - tool_result without a parent tool_use (skipped — orphan).
 *
 * Returned array is sorted by `toolUseAtMs` ascending, so callers
 * can append entries in chronological order alongside the
 * pre-existing prompt_build/llm_text entries.
 */
export function parseTranscriptToolCalls(
  transcriptPath: string,
  sinceMs: number,
): TranscriptToolCall[] {
  if (!existsSync(transcriptPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  // First pass: gather tool_result blocks by tool_use_id so we can
  // attach them in the second pass without quadratic scanning.
  const resultsById = new Map<
    string,
    { content: unknown; isError: boolean; timestampMs: number }
  >();
  // Second pass collects tool_use blocks; declared up here so a
  // single iteration suffices.
  const toolUses: Array<{
    id: string;
    name: string;
    input: unknown;
    timestampMs: number;
  }> = [];

  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev === null || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const ts =
      typeof e.timestamp === "string" ? Date.parse(e.timestamp) : Number.NaN;
    if (!Number.isFinite(ts)) continue;
    // Filter to events emitted DURING this run. A small jitter
    // tolerance (250ms) lets us include events whose timestamp lands
    // microseconds before the runStartTime that was captured at
    // message_received — the two clocks aren't synchronized.
    if (ts < sinceMs - 250) continue;

    const msg = (e.message as { content?: unknown } | undefined) ?? {};
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block === null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") {
        const id = typeof b.id === "string" ? b.id : "";
        const name = typeof b.name === "string" ? b.name : "<unknown>";
        if (id.length === 0) continue;
        toolUses.push({ id, name, input: b.input, timestampMs: ts });
      } else if (b.type === "tool_result") {
        const id =
          typeof b.tool_use_id === "string" ? b.tool_use_id : "";
        if (id.length === 0) continue;
        resultsById.set(id, {
          content: b.content,
          isError: b.is_error === true,
          timestampMs: ts,
        });
      }
    }
  }

  const out: TranscriptToolCall[] = [];
  for (const tu of toolUses) {
    const r = resultsById.get(tu.id);
    out.push({
      toolCallId: tu.id,
      toolName: tu.name,
      input: tu.input,
      result: r === undefined ? null : r.content,
      isError: r?.isError ?? false,
      toolUseAtMs: tu.timestampMs,
    });
  }
  // Sort ascending so the receipt reads chronologically (Read →
  // ToolSearch → WebSearch → WebSearch in our token-106 example).
  out.sort((a, b) => a.toolUseAtMs - b.toolUseAtMs);
  return out;
}
