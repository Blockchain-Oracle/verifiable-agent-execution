/**
 * Tests for packages/logger/src/SessionLogger.ts
 *
 * BDD acceptance from context/docs/stories/story-session-logger.md:
 *   - new SessionLogger(sessionId, storageClient) → empty entries, correct sessionId
 *   - 3 appendEntry calls, each with distinct seq/ts/tool/inputHash/outputHash
 *     → flush() returns LogFlushResult with {rootHash, entryCount: 3, sessionId}
 *   - rootHash is a valid bytes32 hex string
 *   - appendEntry with invalid ExecutionLogEntry → throws (not silently ignored)
 *   - ≥15 behavioral test cases pass
 *   - ≥80% line coverage on SessionLogger
 *
 * Strategy:
 *   - StorageClient is constructed with an injected mock indexer; the
 *     mock returns a deterministic bytes32 rootHash so we can assert on
 *     the LogFlushResult shape without touching the network.
 */

import { Wallet } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ExecutionLogEntry,
  type IndexerLike,
  SessionLogger,
  SessionLoggerError,
  StorageClient,
} from "../src/index.js";

const VALID_ROOT_HASH = `0x${"a".repeat(64)}`;
const VALID_TX_HASH = `0x${"b".repeat(64)}`;
const SHA256 = "c".repeat(64);
const ADDRESS = `0x${"e".repeat(40)}`;
const BYTES32 = `0x${"f".repeat(64)}`;

const META = {
  agentId: ADDRESS,
  containerHash: BYTES32,
  modelId: "claude-sonnet-4-6",
};

function makeEntry(seq: number, overrides?: Partial<ExecutionLogEntry>): ExecutionLogEntry {
  return {
    seq,
    ts: 1_700_000_000_000 + seq,
    type: "tool_call",
    tool: `tool_${seq}`,
    inputHash: SHA256,
    outputHash: SHA256,
    ...overrides,
  };
}

function makeStorageClient(): {
  client: StorageClient;
  uploadSpy: ReturnType<typeof vi.fn>;
  capturedBuffer: { value: Uint8Array | null };
} {
  const capturedBuffer: { value: Uint8Array | null } = { value: null };
  // SDK's `upload` takes a `MemData`-like object whose `.data: ArrayLike<number>`
  // is the underlying buffer. The StorageClient wraps Uint8Array → MemData
  // internally, so the mock pulls bytes back out via `.data`.
  const uploadSpy = vi.fn(async (memData: { data: ArrayLike<number> }) => {
    capturedBuffer.value = Uint8Array.from(memData.data as ArrayLike<number>);
    return [
      { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 1 },
      null,
    ];
  });
  const indexer: IndexerLike = {
    upload: uploadSpy as unknown as IndexerLike["upload"],
    downloadToBlob: (async () => [new Blob([]), null]) as IndexerLike["downloadToBlob"],
  };
  const client = new StorageClient({
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    signer: new Wallet(`0x${"1".repeat(64)}`),
    indexer,
  });
  return { client, uploadSpy, capturedBuffer };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionLogger — construction", () => {
  it("initializes with empty entries and the given sessionId", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_01", client);

    expect(logger.sessionId).toBe("ses_01");
    expect(logger.getEntries()).toHaveLength(0);
    expect(logger.getStatus().flushed).toBe(false);
  });

  it("captures startedAt at construction time when not provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000_000_000));
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_02", client);
    expect(logger.getStatus().startedAt).toBe(2_000_000_000_000);
  });

  it("accepts an explicit startedAt override", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_03", client, { startedAt: 12345 });
    expect(logger.getStatus().startedAt).toBe(12345);
  });

  it("rejects an empty sessionId", () => {
    const { client } = makeStorageClient();
    expect(() => new SessionLogger("", client)).toThrow(SessionLoggerError);
  });
});

describe("SessionLogger — appendEntry", () => {
  it("appends a valid entry and increments getStatus().entryCount", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_10", client);
    logger.appendEntry(makeEntry(0));
    expect(logger.getStatus().entryCount).toBe(1);
    expect(logger.getEntries()[0]?.tool).toBe("tool_0");
  });

  it("appends entries in seq order", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_11", client);
    logger.appendEntry(makeEntry(0));
    logger.appendEntry(makeEntry(1));
    logger.appendEntry(makeEntry(2));
    const entries = logger.getEntries();
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("throws SessionLoggerError when seq is out of order", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_12", client);
    expect(() => logger.appendEntry(makeEntry(5))).toThrow(SessionLoggerError);
  });

  it("throws on a missing required field (Zod validation)", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_13", client);
    const bad = { ...makeEntry(0), inputHash: "not-a-hex" } as ExecutionLogEntry;
    expect(() => logger.appendEntry(bad)).toThrow(SessionLoggerError);
  });

  it("returned getEntries array is a clone; mutating the array does not affect internal state", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_14", client);
    logger.appendEntry(makeEntry(0));
    const view = logger.getEntries() as ExecutionLogEntry[];
    view.push(makeEntry(99));
    expect(logger.getStatus().entryCount).toBe(1);
  });

  it("frozen entries reject field-level mutation (closes Codex P2 on PR #17)", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_15", client);
    logger.appendEntry(makeEntry(0));
    const entry = logger.getEntries()[0]!;
    // Strict mode (vitest runs ESM in strict by default) throws on writes
    // to a frozen object's own properties.
    expect(() => {
      // @ts-expect-error — Readonly<ExecutionLogEntry> rejects assignment.
      entry.seq = 999;
    }).toThrow(TypeError);
    expect(logger.getEntries()[0]?.seq).toBe(0);
  });
});

describe("SessionLogger — setMetadata", () => {
  it("late-binds metadata after construction", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_20", client);
    logger.setMetadata(META);
    logger.appendEntry(makeEntry(0));
    const result = await logger.flush();
    expect(result.entryCount).toBe(1);
  });

  it("throws when called after flush", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_21", client, META);
    await logger.flush();
    expect(() => logger.setMetadata(META)).toThrow(SessionLoggerError);
  });
});

describe("SessionLogger — flush", () => {
  it("returns {rootHash, entryCount, sessionId} after 3 appended entries", async () => {
    const { client, uploadSpy } = makeStorageClient();
    const logger = new SessionLogger("ses_30", client, META);
    logger.appendEntry(makeEntry(0));
    logger.appendEntry(makeEntry(1));
    logger.appendEntry(makeEntry(2));

    const result = await logger.flush();

    expect(result.sessionId).toBe("ses_30");
    expect(result.entryCount).toBe(3);
    expect(result.rootHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
    expect(result.rootHash).toBe(VALID_ROOT_HASH);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("uploads a JSON-encoded SessionLog to storage", async () => {
    const { client, capturedBuffer } = makeStorageClient();
    const logger = new SessionLogger("ses_31", client, META);
    logger.appendEntry(makeEntry(0));
    await logger.flush();

    expect(capturedBuffer.value).not.toBeNull();
    const decoded = JSON.parse(new TextDecoder().decode(capturedBuffer.value!));
    expect(decoded.sessionId).toBe("ses_31");
    expect(decoded.entries).toHaveLength(1);
    expect(decoded.entries[0].tool).toBe("tool_0");
  });

  it("permits flushing an empty session (checkpoint blob, ADR-05)", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_32", client, META);
    const result = await logger.flush();
    expect(result.entryCount).toBe(0);
  });

  it("throws METADATA_MISSING when flushing without setting metadata", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_33", client);
    await expect(logger.flush()).rejects.toMatchObject({
      code: "METADATA_MISSING",
    });
  });

  it("throws ALREADY_FLUSHED on a second flush", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_34", client, META);
    await logger.flush();
    await expect(logger.flush()).rejects.toMatchObject({
      code: "ALREADY_FLUSHED",
    });
  });

  it("throws ALREADY_FLUSHED on appendEntry after flush", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_35", client, META);
    await logger.flush();
    expect(() => logger.appendEntry(makeEntry(0))).toThrow(SessionLoggerError);
  });

  it("captures endedAt at flush time, not earlier", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000_000_000));
    const { client, capturedBuffer } = makeStorageClient();
    const logger = new SessionLogger("ses_36", client, META);
    vi.setSystemTime(new Date(1_000_000_005_000));
    await logger.flush();
    const decoded = JSON.parse(new TextDecoder().decode(capturedBuffer.value!));
    expect(decoded.startedAt).toBe(1_000_000_000_000);
    expect(decoded.endedAt).toBe(1_000_000_005_000);
  });

  it("flushes a large session (200 entries) without drift", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_37", client, META);
    for (let i = 0; i < 200; i++) {
      logger.appendEntry(makeEntry(i));
    }
    const result = await logger.flush();
    expect(result.entryCount).toBe(200);
  });

  it("propagates StorageClient errors (does not swallow upload failure)", async () => {
    const indexer: IndexerLike = {
      upload: (async () => [
        { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 0 },
        new Error("indexer offline"),
      ]) as unknown as IndexerLike["upload"],
      downloadToBlob: (async () => [new Blob([]), null]) as IndexerLike["downloadToBlob"],
    };
    const client = new StorageClient({
      rpcUrl: "https://evmrpc-testnet.0g.ai",
      indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
      signer: new Wallet(`0x${"1".repeat(64)}`),
      indexer,
    });
    const logger = new SessionLogger("ses_38", client, META);
    logger.appendEntry(makeEntry(0));
    await expect(logger.flush()).rejects.toThrow(/Upload failed/);
  });

  it("does not mark as flushed if upload throws (caller can retry)", async () => {
    const indexer: IndexerLike = {
      upload: (async () => {
        throw new Error("network blip");
      }) as unknown as IndexerLike["upload"],
      downloadToBlob: (async () => [new Blob([]), null]) as IndexerLike["downloadToBlob"],
    };
    const client = new StorageClient({
      rpcUrl: "https://evmrpc-testnet.0g.ai",
      indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
      signer: new Wallet(`0x${"1".repeat(64)}`),
      indexer,
    });
    const logger = new SessionLogger("ses_39", client, META);
    logger.appendEntry(makeEntry(0));
    await expect(logger.flush()).rejects.toThrow();
    expect(logger.getStatus().flushed).toBe(false);
  });

  it("rejects a concurrent flush() while one is in-flight (closes Codex P1 on PR #17)", async () => {
    // Build an indexer whose upload waits on a deferred promise so we
    // can hold the first flush mid-flight while we issue a second.
    let releaseFirst!: () => void;
    const firstUploadGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const indexer: IndexerLike = {
      upload: (async () => {
        await firstUploadGate;
        return [
          { rootHash: VALID_ROOT_HASH, txHash: VALID_TX_HASH, txSeq: 7 },
          null,
        ];
      }) as unknown as IndexerLike["upload"],
      downloadToBlob: (async () => [new Blob([]), null]) as IndexerLike["downloadToBlob"],
    };
    const client = new StorageClient({
      rpcUrl: "https://evmrpc-testnet.0g.ai",
      indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
      signer: new Wallet(`0x${"1".repeat(64)}`),
      indexer,
    });
    const logger = new SessionLogger("ses_42", client, META);
    logger.appendEntry(makeEntry(0));

    // Kick the first flush; it parks at the upload gate.
    const inFlight = logger.flush();

    // While the first is in-flight, a second flush MUST throw with
    // ALREADY_FLUSHED (the "flush in progress" branch).
    await expect(logger.flush()).rejects.toMatchObject({
      code: "ALREADY_FLUSHED",
    });

    // Concurrent appendEntry MUST also throw — desyncing the uploaded
    // blob from the eventual entryCount is exactly what the lock
    // prevents.
    expect(() => logger.appendEntry(makeEntry(1))).toThrow(SessionLoggerError);

    // Release the first upload; it completes successfully.
    releaseFirst();
    const result = await inFlight;
    expect(result.entryCount).toBe(1);
    expect(logger.getStatus().flushed).toBe(true);
  });
});

describe("SessionLogger — getStatus", () => {
  it("reports sessionId, entryCount, flushed=false, startedAt", () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_40", client, { startedAt: 1 });
    expect(logger.getStatus()).toEqual({
      sessionId: "ses_40",
      entryCount: 0,
      flushed: false,
      startedAt: 1,
    });
  });

  it("flips flushed=true after a successful flush", async () => {
    const { client } = makeStorageClient();
    const logger = new SessionLogger("ses_41", client, META);
    await logger.flush();
    expect(logger.getStatus().flushed).toBe(true);
  });
});
