/**
 * exec-log-parser.test.ts — pins the centralized parser's contract.
 *
 * v0.3.4 introduced this helper to replace 5 scattered callsites that
 * had each been bug-fixed independently (most notably the round-4 P1
 * colon-in-sessionId truncation). Tests below lock both the happy
 * paths (both known prefixes) AND the malformed-input return-null
 * contract so future callsites can rely on the same behavior.
 */

import { describe, it, expect } from "vitest";

import {
  isExecutionLogDescription,
  parseExecutionLogDescription,
} from "../src/lib/exec-log-parser";

describe("isExecutionLogDescription", () => {
  it("returns true for normal exec-log: anchors", () => {
    expect(isExecutionLogDescription("exec-log:abc:claude")).toBe(true);
  });

  it("returns true for exec-log-orphan: recovery anchors", () => {
    expect(isExecutionLogDescription("exec-log-orphan:abc:claude")).toBe(true);
  });

  it("returns false for unrelated dataDescriptions (other plugins, hand-mints)", () => {
    expect(isExecutionLogDescription("memory:something")).toBe(false);
    expect(isExecutionLogDescription("agent-card")).toBe(false);
    expect(isExecutionLogDescription("")).toBe(false);
  });

  it("returns false for non-string input (defensive against ABI mismatch)", () => {
    expect(isExecutionLogDescription(undefined)).toBe(false);
    expect(isExecutionLogDescription(null)).toBe(false);
    expect(isExecutionLogDescription(123)).toBe(false);
    expect(isExecutionLogDescription({})).toBe(false);
  });

  it("does NOT confuse exec-log-orphan with exec-log (longer prefix tested first)", () => {
    // Without the longer-prefix-first rule, an `exec-log-orphan:...`
    // string would naively match `exec-log:` as a substring of its
    // own prefix. Verify the implementation gets the precedence
    // right — `parseExecutionLogDescription` of an orphan dataDescription
    // returns recoveryAnchor:true, NOT recoveryAnchor:false (which is
    // what a too-greedy exec-log: match would produce).
    const parsed = parseExecutionLogDescription("exec-log-orphan:abc:claude");
    expect(parsed).not.toBeNull();
    expect(parsed?.recoveryAnchor).toBe(true);
  });
});

describe("parseExecutionLogDescription — happy paths", () => {
  it("parses a simple exec-log: anchor", () => {
    expect(parseExecutionLogDescription("exec-log:abc:claude")).toEqual({
      sessionId: "abc",
      modelId: "claude",
      recoveryAnchor: false,
    });
  });

  it("parses a simple exec-log-orphan: recovery anchor", () => {
    expect(parseExecutionLogDescription("exec-log-orphan:abc:claude")).toEqual({
      sessionId: "abc",
      modelId: "claude",
      recoveryAnchor: true,
    });
  });

  it("preserves colons inside sessionId (Codex round-4 P1 regression)", () => {
    // Real VPS sessionKey shape — must round-trip without split(":")
    // truncating to "agent".
    expect(
      parseExecutionLogDescription(
        "exec-log:agent:core:telegram:direct:8028166336:claude-sonnet-4-6",
      ),
    ).toEqual({
      sessionId: "agent:core:telegram:direct:8028166336",
      modelId: "claude-sonnet-4-6",
      recoveryAnchor: false,
    });
  });

  it("preserves colons inside sessionId on orphan anchors too", () => {
    expect(
      parseExecutionLogDescription(
        "exec-log-orphan:agent:core:telegram:direct:8028166336:claude-sonnet-4-6",
      ),
    ).toEqual({
      sessionId: "agent:core:telegram:direct:8028166336",
      modelId: "claude-sonnet-4-6",
      recoveryAnchor: true,
    });
  });
});

describe("parseExecutionLogDescription — malformed inputs return null", () => {
  it("returns null on unknown prefix", () => {
    expect(parseExecutionLogDescription("memory:abc:claude")).toBeNull();
    expect(parseExecutionLogDescription("agent-card")).toBeNull();
    expect(parseExecutionLogDescription("")).toBeNull();
  });

  it("returns null when sessionId is empty (no inner colon)", () => {
    // "exec-log:foo" — slicing off the prefix gives "foo" with no
    // internal `:`, lastIndexOf returns -1.
    expect(parseExecutionLogDescription("exec-log:foo")).toBeNull();
  });

  it("returns null when sessionId is empty (final colon at start)", () => {
    // "exec-log::claude" — slicing gives ":claude"; lastIndexOf is 0
    // which we reject (sessionId would be empty).
    expect(parseExecutionLogDescription("exec-log::claude")).toBeNull();
  });

  it("returns null when modelId is empty (trailing colon)", () => {
    expect(parseExecutionLogDescription("exec-log:abc:")).toBeNull();
    expect(parseExecutionLogDescription("exec-log-orphan:abc:")).toBeNull();
  });
});
