/**
 * SessionLogger — accumulates ExecutionLogEntry rows during an OpenClaw
 * session and flushes them as a single SessionLog JSON blob to 0G Storage.
 *
 * Invariants:
 *   - entries are appended in seq order; seq must be monotonically
 *     increasing and 0-indexed contiguous (validated at flush time)
 *   - appendEntry validates each row with the Zod schema; invalid rows
 *     throw immediately (never silently dropped)
 *   - flush() may be called exactly once per session; subsequent calls
 *     throw (a second flush would mint a divergent log for the same id)
 *   - appendEntry after flush() throws (the log is sealed)
 *   - metadata (agentId/containerHash/modelId) must be set before flush;
 *     can be passed at construction OR via setMetadata() before flush
 *   - empty sessions are allowed to flush (matches ADR-05: crash-mitigation
 *     checkpoint blob written at session start with `{sessionId, startedAt}`
 *     before any tool calls happen)
 */

import {
  type ExecutionLogEntry,
  executionLogEntrySchema,
  type LogFlushResult,
  type SessionLog,
  sessionLogSchema,
} from "./types.js";
import { StorageClient } from "./StorageClient.js";

export interface SessionMetadata {
  agentId: string;
  containerHash: string;
  modelId: string;
}

export interface SessionLoggerOptions extends Partial<SessionMetadata> {
  /** Override the initial timestamp (ms). Defaults to Date.now() at construction. */
  startedAt?: number;
}

export interface SessionLoggerStatus {
  sessionId: string;
  entryCount: number;
  flushed: boolean;
  startedAt: number;
}

export class SessionLoggerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SessionLoggerError";
    this.code = code;
  }
}

export class SessionLogger {
  readonly sessionId: string;
  private readonly storageClient: StorageClient;
  private readonly entries: ExecutionLogEntry[] = [];
  private readonly startedAt: number;
  private metadata: Partial<SessionMetadata>;
  private flushed = false;

  constructor(
    sessionId: string,
    storageClient: StorageClient,
    options: SessionLoggerOptions = {},
  ) {
    if (sessionId.length === 0) {
      throw new SessionLoggerError(
        "EMPTY_SESSION_ID",
        "sessionId must be non-empty",
      );
    }
    this.sessionId = sessionId;
    this.storageClient = storageClient;
    this.startedAt = options.startedAt ?? Date.now();
    this.metadata = {
      agentId: options.agentId,
      containerHash: options.containerHash,
      modelId: options.modelId,
    };
  }

  /**
   * Append a single ExecutionLogEntry. Validates with Zod and enforces
   * monotonically-increasing 0-indexed seq.
   *
   * Throws SessionLoggerError on validation failure or invalid seq;
   * throws if the session has already been flushed.
   */
  appendEntry(entry: ExecutionLogEntry): void {
    if (this.flushed) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        `Cannot append to session ${this.sessionId}: already flushed`,
      );
    }

    const result = executionLogEntrySchema.safeParse(entry);
    if (!result.success) {
      throw new SessionLoggerError(
        "INVALID_ENTRY",
        `ExecutionLogEntry validation failed: ${result.error.message}`,
      );
    }

    const expectedSeq = this.entries.length;
    if (result.data.seq !== expectedSeq) {
      throw new SessionLoggerError(
        "SEQ_OUT_OF_ORDER",
        `Expected seq=${expectedSeq}, got seq=${result.data.seq}`,
      );
    }

    this.entries.push(result.data);
  }

  /**
   * Late-bind session metadata. Useful when agent identity / container
   * hash / model id aren't known at construction time but become
   * available before session end (the typical OpenClaw lifecycle).
   */
  setMetadata(metadata: SessionMetadata): void {
    if (this.flushed) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        "Cannot setMetadata after flush",
      );
    }
    this.metadata = { ...metadata };
  }

  /**
   * Read-only view of the accumulated entries. The returned array is a
   * shallow clone; callers cannot mutate internal state.
   */
  getEntries(): ReadonlyArray<ExecutionLogEntry> {
    return [...this.entries];
  }

  getStatus(): SessionLoggerStatus {
    return {
      sessionId: this.sessionId,
      entryCount: this.entries.length,
      flushed: this.flushed,
      startedAt: this.startedAt,
    };
  }

  /**
   * Assemble the SessionLog, validate structurally, serialize as JSON,
   * upload to 0G Storage, and return the LogFlushResult.
   *
   * Exactly-once: a second flush throws SessionLoggerError("ALREADY_FLUSHED").
   * Metadata must be set first or this throws SessionLoggerError("METADATA_MISSING").
   */
  async flush(): Promise<LogFlushResult> {
    if (this.flushed) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        `Session ${this.sessionId} already flushed`,
      );
    }

    const { agentId, containerHash, modelId } = this.metadata;
    if (!agentId || !containerHash || !modelId) {
      throw new SessionLoggerError(
        "METADATA_MISSING",
        "Cannot flush before agentId, containerHash, and modelId are set " +
          "(constructor opts or setMetadata)",
      );
    }

    const sessionLog: SessionLog = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      agentId,
      containerHash,
      modelId,
      entries: [...this.entries],
      entryCount: this.entries.length,
    };

    // Validate the assembled log against the schema (catches refinements
    // like entryCount/length mismatch, endedAt < startedAt, seq drift).
    const parseResult = sessionLogSchema.safeParse(sessionLog);
    if (!parseResult.success) {
      throw new SessionLoggerError(
        "INVALID_SESSION_LOG",
        `SessionLog validation failed: ${parseResult.error.message}`,
      );
    }

    const buffer = new TextEncoder().encode(
      JSON.stringify(parseResult.data),
    );

    const upload = await this.storageClient.upload(buffer);

    this.flushed = true;

    return {
      rootHash: upload.rootHash,
      entryCount: this.entries.length,
      sessionId: this.sessionId,
    };
  }
}
