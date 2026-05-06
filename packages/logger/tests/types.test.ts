/**
 * Tests for packages/logger/src/types.ts
 *
 * BDD acceptance from context/docs/stories/story-log-schema.md:
 *
 *   - "all three types export from packages/logger/src/index.ts"
 *      → covered by the import statement at the top of this file (compile-time)
 *   - "zod.parse(ExecutionLogEntry, {seq: 0, ts: Date.now(), ...}) returns
 *      the parsed object without error"
 *      → tests `parses a minimal valid ExecutionLogEntry` and
 *        `parses a fully-populated ExecutionLogEntry`
 *
 * Beyond the BDD, we encode the structural refines on SessionLog
 * (entryCount/seq/timestamp invariants) so a tampered log is caught at
 * parse time rather than producing a corrupt anchor.
 */

import { describe, expect, it } from "vitest";
import {
  type ExecutionLogEntry,
  executionLogEntrySchema,
  type LogFlushResult,
  logFlushResultSchema,
  type SessionLog,
  sessionLogSchema,
} from "../src/index.js";

const SHA256_HEX = "a".repeat(64);
const BYTES32 = `0x${"b".repeat(64)}`;
const ADDRESS = `0x${"c".repeat(40)}`;
const SIG_65 = `0x${"d".repeat(130)}`;

const baseEntry: ExecutionLogEntry = {
  seq: 0,
  ts: 1_700_000_000_000,
  type: "tool_call",
  tool: "web_search",
  inputHash: SHA256_HEX,
  outputHash: SHA256_HEX,
};

describe("ExecutionLogEntry", () => {
  it("parses a minimal valid entry (BDD: happy path)", () => {
    const parsed = executionLogEntrySchema.parse(baseEntry);
    expect(parsed.seq).toBe(0);
    expect(parsed.tool).toBe("web_search");
  });

  it("parses a fully-populated entry with TEE-signed fields", () => {
    const full: ExecutionLogEntry = {
      ...baseEntry,
      type: "inference",
      modelId: "claude-sonnet-4-6",
      teeSignature: SIG_65,
      teeSigningAddress: ADDRESS,
      agentId: ADDRESS,
      sealId: BYTES32,
      signedAt: 1_700_000_000,
    };
    const parsed = executionLogEntrySchema.parse(full);
    expect(parsed.teeSignature).toBe(SIG_65);
    expect(parsed.signedAt).toBe(1_700_000_000);
  });

  it("rejects negative seq", () => {
    const result = executionLogEntrySchema.safeParse({ ...baseEntry, seq: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer ts", () => {
    const result = executionLogEntrySchema.safeParse({ ...baseEntry, ts: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects unknown type enum", () => {
    const result = executionLogEntrySchema.safeParse({
      ...baseEntry,
      type: "unknown_type" as unknown as "tool_call",
    });
    expect(result.success).toBe(false);
  });

  it("rejects inputHash with 0x prefix (sha256 fields are stored without 0x)", () => {
    const result = executionLogEntrySchema.safeParse({
      ...baseEntry,
      inputHash: `0x${SHA256_HEX}`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed teeSignature (wrong length)", () => {
    const result = executionLogEntrySchema.safeParse({
      ...baseEntry,
      teeSignature: `0x${"a".repeat(128)}`, // 64 bytes instead of 65
    });
    expect(result.success).toBe(false);
  });

  it("rejects teeSigningAddress that is not 20 bytes", () => {
    const result = executionLogEntrySchema.safeParse({
      ...baseEntry,
      teeSigningAddress: `0x${"a".repeat(38)}`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects entry missing required outputHash", () => {
    const { outputHash, ...partial } = baseEntry;
    void outputHash;
    const result = executionLogEntrySchema.safeParse(partial);
    expect(result.success).toBe(false);
  });
});

describe("SessionLog", () => {
  const baseSession: SessionLog = {
    sessionId: "ses_01J6ABCDE",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    agentId: ADDRESS,
    containerHash: BYTES32,
    modelId: "claude-sonnet-4-6",
    entries: [baseEntry, { ...baseEntry, seq: 1, ts: 1_700_000_001_000 }],
    entryCount: 2,
  };

  it("parses a valid session", () => {
    const parsed = sessionLogSchema.parse(baseSession);
    expect(parsed.entryCount).toBe(2);
    expect(parsed.entries).toHaveLength(2);
  });

  it("rejects entryCount mismatch with entries.length", () => {
    const result = sessionLogSchema.safeParse({ ...baseSession, entryCount: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects endedAt < startedAt (timestamp invariant)", () => {
    const result = sessionLogSchema.safeParse({
      ...baseSession,
      endedAt: baseSession.startedAt - 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects entries whose seq is not 0-indexed contiguous", () => {
    const result = sessionLogSchema.safeParse({
      ...baseSession,
      entries: [{ ...baseEntry, seq: 5 }, { ...baseEntry, seq: 6 }],
      entryCount: 2,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty session (entries=[], entryCount=0)", () => {
    const parsed = sessionLogSchema.parse({
      ...baseSession,
      entries: [],
      entryCount: 0,
    });
    expect(parsed.entries).toHaveLength(0);
  });
});

describe("LogFlushResult", () => {
  it("parses a valid flush result", () => {
    const result: LogFlushResult = {
      rootHash: BYTES32,
      entryCount: 3,
      sessionId: "ses_01J6ABCDE",
    };
    expect(logFlushResultSchema.parse(result)).toEqual(result);
  });

  it("rejects rootHash without 0x prefix", () => {
    const result = logFlushResultSchema.safeParse({
      rootHash: "b".repeat(64),
      entryCount: 0,
      sessionId: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative entryCount", () => {
    const result = logFlushResultSchema.safeParse({
      rootHash: BYTES32,
      entryCount: -1,
      sessionId: "x",
    });
    expect(result.success).toBe(false);
  });
});
