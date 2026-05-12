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

/**
 * Optional flush() callback for v0.3.0 client-side encryption. When
 * provided, the SessionLogger calls `encrypt(jsonPlaintext)` and
 * uploads the returned bytes verbatim. The cipher closure encapsulates
 * the key (the SessionLogger NEVER sees it); the plugin owns
 * generation + persistence (see `keystore.ts` for the crash-recovery
 * ordering that wraps this).
 *
 * Return contract: must be a Uint8Array (or Buffer) ready to upload.
 * The bytes' format is the caller's responsibility; recommended is
 * `TextEncoder.encode(JSON.stringify(envelope))` where envelope is an
 * `EncryptedSessionLogEnvelope` from `openclaw-skills/.../crypto.ts`.
 * The dashboard's `isEncryptedEnvelope` type guard distinguishes
 * encrypted-envelope bytes from legacy plaintext SessionLog bytes.
 */
export interface FlushOptions {
  encrypt?: (plaintextJson: string) => Uint8Array;
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
  /**
   * `flushing` is set BEFORE the upload await so concurrent flush() calls
   * can't both pass the guard and double-anchor the session. `flushed` is
   * set only on a successful upload — if the upload throws, `flushing`
   * resets so the caller can retry. This keeps the exactly-once invariant
   * while preserving the public "retry on transport failure" contract.
   * (Codex P1 on PR #17.)
   */
  private flushing = false;
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
    // Block appends both during AND after flush. Allowing appends during
    // flush would desynchronize the uploaded blob from the returned
    // entryCount (Codex P1 on PR #17 — second-half of the same race).
    if (this.flushed || this.flushing) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        `Cannot append to session ${this.sessionId}: ${this.flushed ? "already flushed" : "flush in progress"}`,
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

    // Freeze the entry on append so the read-only contract on
    // getEntries() actually holds — callers cannot mutate the inner
    // object reference and corrupt later flush behavior (Codex P2 on
    // PR #17). The frozen object still satisfies ExecutionLogEntry
    // because Object.freeze does not change the type.
    this.entries.push(Object.freeze(result.data) as ExecutionLogEntry);
  }

  /**
   * Late-bind session metadata. Useful when agent identity / container
   * hash / model id aren't known at construction time but become
   * available before session end (the typical OpenClaw lifecycle).
   */
  setMetadata(metadata: SessionMetadata): void {
    if (this.flushed || this.flushing) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        `Cannot setMetadata: ${this.flushed ? "already flushed" : "flush in progress"}`,
      );
    }
    this.metadata = { ...metadata };
  }

  /**
   * Read-only view of the accumulated entries. Returns a shallow clone of
   * the array; the entry objects themselves are frozen at append time so
   * callers can neither push to the array NOR mutate fields on individual
   * entries. (Closes Codex P2 on PR #17 — array-clone alone left field-
   * level mutation possible: `getEntries()[i].seq = 999` was a footgun.)
   */
  getEntries(): ReadonlyArray<Readonly<ExecutionLogEntry>> {
    return [...this.entries] as ReadonlyArray<Readonly<ExecutionLogEntry>>;
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
   * Exactly-once under concurrent callers: `flushing` is set BEFORE the
   * upload await so a second concurrent flush() throws immediately. On
   * success `flushed` is set; on upload failure `flushing` resets so
   * the caller can retry. (Codex P1 on PR #17.)
   *
   * Metadata must be set first or this throws SessionLoggerError(
   * "METADATA_MISSING").
   */
  async flush(opts?: FlushOptions): Promise<LogFlushResult> {
    if (this.flushed || this.flushing) {
      throw new SessionLoggerError(
        "ALREADY_FLUSHED",
        `Session ${this.sessionId}: ${this.flushed ? "already flushed" : "flush already in progress"}`,
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
    // Validation happens BEFORE we set `flushing`, so a programmer error
    // here doesn't poison the session state — caller can fix and retry.
    const parseResult = sessionLogSchema.safeParse(sessionLog);
    if (!parseResult.success) {
      throw new SessionLoggerError(
        "INVALID_SESSION_LOG",
        `SessionLog validation failed: ${parseResult.error.message}`,
      );
    }

    // v0.3.0: optional encryption hook. When provided, the plaintext
    // JSON is transformed into the upload buffer by the caller (the
    // plugin). The cipher closure encapsulates the key — SessionLogger
    // never sees it. Bytes uploaded are whatever the cipher emits.
    const plaintextJson = JSON.stringify(parseResult.data);
    const buffer =
      opts?.encrypt !== undefined
        ? opts.encrypt(plaintextJson)
        : new TextEncoder().encode(plaintextJson);

    // Lock-before-await: any concurrent flush() will see flushing=true
    // and throw before reaching the upload, and any concurrent
    // appendEntry() likewise blocks while the snapshot is in flight.
    this.flushing = true;
    try {
      const upload = await this.storageClient.upload(buffer);
      this.flushed = true;
      return {
        rootHash: upload.rootHash,
        entryCount: this.entries.length,
        sessionId: this.sessionId,
      };
    } catch (err) {
      // Reset the lock so the caller can retry on transport failure.
      // The session is NOT marked flushed; entries remain available.
      this.flushing = false;
      throw err;
    }
  }
}
