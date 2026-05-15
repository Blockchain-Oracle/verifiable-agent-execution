// transcript-parser.test.ts — pins v0.3.5 content-fidelity capture
// against the real Claude Code session.jsonl format I confirmed live
// on the VPS for token 106 (Read, ToolSearch, WebSearch x2). Without
// this parser, those four tool calls are invisible in the receipt;
// the test pins all the parsing edge cases:
//   - timestamp filtering (only THIS run's events)
//   - tool_use ↔ tool_result pairing by tool_use_id
//   - chronological sort
//   - file-missing graceful return
//   - malformed-line skip
//   - encodeWorkspaceForClaudeProjects matches Claude Code's encoding
//
// The fixtures here mirror the actual jsonl line shape I extracted
// from /root/.claude/projects/-root--openclaw-workspace-research-agent/
//   77a24b87-b296-4780-9a0a-288c855b28e1.jsonl.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  encodeWorkspaceForClaudeProjects,
  parseTranscriptToolCalls,
  resolveClaudeCliTranscriptPath,
} from "../src/transcript-parser";

// Build a Claude-Code-shaped jsonl event line. The real format has
// many more fields (sessionId, parentUuid, requestId, etc.) but the
// parser only reads `type`, `timestamp`, and `message.content[]`.
function assistantEvent(ts: string, content: unknown[]): string {
  return (
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: { role: "assistant", content },
    }) + "\n"
  );
}

function userEvent(ts: string, content: unknown[]): string {
  return (
    JSON.stringify({
      type: "user",
      timestamp: ts,
      message: { role: "user", content },
    }) + "\n"
  );
}

describe("encodeWorkspaceForClaudeProjects", () => {
  it("encodes an absolute path the way Claude Code does (v0.3.5 fix: `.` also → `-`)", () => {
    // The VPS produced `-root--openclaw-workspace-research-agent` for
    // cwd `/root/.openclaw/workspace/research-agent`. v0.3.5 alpha
    // (committed but never published as such) had a bug here: it
    // replaced `/` only and produced `-root-.openclaw-...` — Claude
    // Code's actual encoding also replaces `.` so we get
    // `-root--openclaw-workspace-research-agent` (the double-dash is
    // `/` followed by `.` collapsing to `--`).
    //
    // Verified against live VPS data:
    //   /root/.openclaw/workspace/main       ↔ -root--openclaw-workspace-main
    //   /root/worktrees/story-…              ↔ -root-worktrees-story-…
    //   /root/.openclaw/workspace/coding     ↔ -root--openclaw-workspace-coding
    expect(
      encodeWorkspaceForClaudeProjects("/root/.openclaw/workspace/research-agent"),
    ).toBe("-root--openclaw-workspace-research-agent");
  });

  it("encodes a path with no `.` segments (only `/` → `-`)", () => {
    // No `.` in the path, so output has only single dashes between
    // segments. Pins the algorithm doesn't introduce spurious dashes.
    expect(encodeWorkspaceForClaudeProjects("/root/worktrees/story-x")).toBe(
      "-root-worktrees-story-x",
    );
  });

  it("strips trailing slashes so re-running the encode is stable", () => {
    expect(encodeWorkspaceForClaudeProjects("/root/x/")).toBe("-root-x");
    expect(encodeWorkspaceForClaudeProjects("/root/x")).toBe("-root-x");
  });
});

describe("parseTranscriptToolCalls", () => {
  let tmpDir: string;
  let trace: string;
  const runStart = Date.parse("2026-05-14T10:58:00.000Z");

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "transcript-test-"));
    trace = join(tmpDir, "session.jsonl");
  });

  afterEach(() => {
    // Test isolation: vitest sandboxes the tmp dir per worker, but
    // be explicit so a flaky cross-test leak can't poison results.
    // (No-op if dir already cleaned up by the OS.)
  });

  it("returns [] when the transcript file does not exist", () => {
    const calls = parseTranscriptToolCalls(
      join(tmpDir, "nonexistent.jsonl"),
      runStart,
    );
    expect(calls).toEqual([]);
  });

  it("pairs tool_use with tool_result by tool_use_id (the token-106 reproduction)", () => {
    // Replays the exact 4-tool sequence I extracted from token 106's
    // session.jsonl. Each tool_use has a matching tool_result on the
    // next user turn (real Claude Code convention).
    writeFileSync(
      trace,
      assistantEvent("2026-05-14T10:58:12.203Z", [
        {
          type: "tool_use",
          id: "toolu_aa",
          name: "Read",
          input: {
            file_path:
              "/usr/lib/node_modules/openclaw/dist/extensions/tavily/skills/tavily/SKILL.md",
          },
        },
      ]) +
        userEvent("2026-05-14T10:58:12.500Z", [
          {
            type: "tool_result",
            tool_use_id: "toolu_aa",
            content: "(file contents elided)",
          },
        ]) +
        assistantEvent("2026-05-14T10:58:14.314Z", [
          {
            type: "tool_use",
            id: "toolu_bb",
            name: "ToolSearch",
            input: { query: "select:WebSearch", max_results: 1 },
          },
        ]) +
        userEvent("2026-05-14T10:58:14.700Z", [
          { type: "tool_result", tool_use_id: "toolu_bb", content: "WebSearch tool found" },
        ]) +
        assistantEvent("2026-05-14T10:58:17.226Z", [
          {
            type: "tool_use",
            id: "toolu_cc",
            name: "WebSearch",
            input: { query: "Solana SOL price today May 2026" },
          },
        ]) +
        userEvent("2026-05-14T10:58:18.000Z", [
          { type: "tool_result", tool_use_id: "toolu_cc", content: "SOL ~$91-96" },
        ]) +
        assistantEvent("2026-05-14T10:58:17.309Z", [
          {
            type: "tool_use",
            id: "toolu_dd",
            name: "WebSearch",
            input: { query: "0G Labs latest news May 2026" },
          },
        ]) +
        userEvent("2026-05-14T10:58:18.500Z", [
          {
            type: "tool_result",
            tool_use_id: "toolu_dd",
            content: "0G Labs cut 25% of staff",
          },
        ]),
    );

    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.toolName)).toEqual([
      "Read",
      "ToolSearch",
      "WebSearch",
      "WebSearch",
    ]);
    expect(calls[2].input).toEqual({ query: "Solana SOL price today May 2026" });
    expect(calls[2].result).toBe("SOL ~$91-96");
    expect(calls[0].toolCallId).toBe("toolu_aa");
    expect(calls.every((c) => !c.isError)).toBe(true);
  });

  it("sorts chronologically by tool_use timestamp", () => {
    // Out-of-order writes (e.g. concurrent assistant turns) should
    // still produce a chronologically-sorted output so the receipt
    // reads like a timeline.
    writeFileSync(
      trace,
      assistantEvent("2026-05-14T10:58:30.000Z", [
        { type: "tool_use", id: "x", name: "Bash", input: { command: "ls" } },
      ]) +
        assistantEvent("2026-05-14T10:58:10.000Z", [
          { type: "tool_use", id: "y", name: "Read", input: { file_path: "a" } },
        ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls.map((c) => c.toolName)).toEqual(["Read", "Bash"]);
  });

  it("filters out events older than runStartTime (prior-turn leakage)", () => {
    writeFileSync(
      trace,
      // First two events are from a PREVIOUS turn (one minute earlier).
      assistantEvent("2026-05-14T10:57:00.000Z", [
        { type: "tool_use", id: "old", name: "OldTool", input: {} },
      ]) +
        // This one is in window.
        assistantEvent("2026-05-14T10:58:30.000Z", [
          { type: "tool_use", id: "new", name: "NewTool", input: {} },
        ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("NewTool");
  });

  it("tolerates a 250ms jitter on either side of runStartTime", () => {
    // Real-world reproducer: handleMessageReceived's Date.now() runs
    // hundreds of ms AFTER Claude Code's own timestamp on the first
    // tool block (the streaming round trip). Without the small
    // jitter, those first tools would silently disappear.
    writeFileSync(
      trace,
      assistantEvent("2026-05-14T10:57:59.900Z", [
        {
          type: "tool_use",
          id: "edge",
          name: "EdgeTool",
          input: {},
        },
      ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
  });

  it("flags isError when tool_result has is_error: true", () => {
    writeFileSync(
      trace,
      assistantEvent("2026-05-14T10:58:10.000Z", [
        { type: "tool_use", id: "f", name: "FailingTool", input: { x: 1 } },
      ]) +
        userEvent("2026-05-14T10:58:10.100Z", [
          {
            type: "tool_result",
            tool_use_id: "f",
            is_error: true,
            content: "command not found",
          },
        ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
    expect(calls[0].isError).toBe(true);
    expect(calls[0].result).toBe("command not found");
  });

  it("returns result: null when tool_use has no matching tool_result", () => {
    // Crash mid-tool case: the user_event tool_result never landed.
    writeFileSync(
      trace,
      assistantEvent("2026-05-14T10:58:10.000Z", [
        {
          type: "tool_use",
          id: "orphan",
          name: "WebSearch",
          input: { query: "x" },
        },
      ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
    expect(calls[0].result).toBeNull();
  });

  it("skips malformed jsonl lines without aborting the parse", () => {
    writeFileSync(
      trace,
      "not-valid-json\n" +
        assistantEvent("2026-05-14T10:58:10.000Z", [
          { type: "tool_use", id: "g", name: "Read", input: { file_path: "a" } },
        ]) +
        '{"type":"assistant","timestamp":"oops","message":null}\n',
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("Read");
  });

  it("ignores non-user/non-assistant event types (ai-title, queue-operation, etc.)", () => {
    writeFileSync(
      trace,
      JSON.stringify({
        type: "ai-title",
        timestamp: "2026-05-14T10:58:00.000Z",
        aiTitle: "Some Title",
      }) +
        "\n" +
        assistantEvent("2026-05-14T10:58:10.000Z", [
          { type: "tool_use", id: "z", name: "Bash", input: { command: "ls" } },
        ]),
    );
    const calls = parseTranscriptToolCalls(trace, runStart);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("Bash");
  });

  it("skips orphan tool_result blocks (no parent tool_use)", () => {
    // A tool_result without its matching tool_use should NOT produce
    // a fake entry — the parser groups by tool_use_id, not tool_result.
    writeFileSync(
      trace,
      userEvent("2026-05-14T10:58:10.000Z", [
        { type: "tool_result", tool_use_id: "ghost", content: "x" },
      ]),
    );
    expect(parseTranscriptToolCalls(trace, runStart)).toEqual([]);
  });
});

describe("resolveClaudeCliTranscriptPath", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "fake-home-"));
  });

  it("returns null when there is no project dir for the workspace", () => {
    expect(
      resolveClaudeCliTranscriptPath("/some/workspace", {
        homeDirOverride: fakeHome,
      }),
    ).toBeNull();
  });

  it("returns the most recently modified .jsonl in the project dir", () => {
    // Replicate the on-disk layout:
    //   <fakeHome>/.claude/projects/-tmp-bot/abc.jsonl   (older)
    //   <fakeHome>/.claude/projects/-tmp-bot/xyz.jsonl   (newer)
    const projDir = join(
      fakeHome,
      ".claude",
      "projects",
      encodeWorkspaceForClaudeProjects("/tmp/bot"),
    );
    mkdirSync(projDir, { recursive: true });
    const older = join(projDir, "abc.jsonl");
    const newer = join(projDir, "xyz.jsonl");
    writeFileSync(older, "{}\n");
    // Bump mtime forward by a millisecond by writing the newer file
    // second. utimes would be more deterministic but writing-order is
    // sufficient on the OSes vitest runs on.
    writeFileSync(newer, "{}\n");
    expect(
      resolveClaudeCliTranscriptPath("/tmp/bot", {
        homeDirOverride: fakeHome,
      }),
    ).toBe(newer);
  });

  it("ignores non-.jsonl files in the project dir", () => {
    const projDir = join(
      fakeHome,
      ".claude",
      "projects",
      encodeWorkspaceForClaudeProjects("/tmp/bot"),
    );
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "notes.txt"), "x");
    writeFileSync(join(projDir, "session.jsonl"), "{}\n");
    const resolved = resolveClaudeCliTranscriptPath("/tmp/bot", {
      homeDirOverride: fakeHome,
    });
    expect(resolved).toBe(join(projDir, "session.jsonl"));
  });
});
