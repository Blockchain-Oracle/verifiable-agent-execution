/**
 * SessionManager — sessionId → SessionLogger map with lazy allocation.
 *
 * OpenClaw doesn't expose an explicit `session_start` hook in the
 * canonical reference plugin (0g-memory/openclaw-skills/evermemos);
 * instead, sessions surface lazily on the first `after_tool_call`
 * with a new sessionId. We mirror that pattern: allocate a
 * SessionLogger on first sight of a sessionId, append entries on each
 * subsequent tool call, and surface the SessionLogger to `session_end`
 * for the flush+mint orchestration (story-skill-close).
 *
 * Lifecycle invariants:
 *   - getOrCreate(sessionId) is idempotent — repeated calls return the
 *     same SessionLogger so multiple tool calls in the same session
 *     share state.
 *   - release(sessionId) drops the SessionLogger AFTER session_end has
 *     consumed it. Done in `session_end` after flush+mint completes
 *     so memory doesn't leak across long-running OpenClaw processes.
 *   - SessionLogger metadata (agentId, modelId, containerHash) is set
 *     by the session_end handler at flush time, NOT at allocation
 *     time, because containerHash is only known at session end (per
 *     SessionLogger's late-bind design).
 */

import {
  SessionLogger,
  type StorageClient,
} from "@verifiable-agent-execution/logger";

export interface SessionManagerDeps {
  /**
   * StorageClient instance shared across all sessions. Built once at
   * plugin load time from the resolved config; injected here so unit
   * tests can substitute a stub without standing up the 0G SDK.
   */
  storageClient: StorageClient;
}

export class SessionManager {
  private readonly storageClient: StorageClient;
  private readonly loggers = new Map<string, SessionLogger>();

  constructor(deps: SessionManagerDeps) {
    this.storageClient = deps.storageClient;
  }

  /**
   * Return the SessionLogger bound to `sessionId`, allocating a fresh
   * one on first sight. The metadata fields (agentId, containerHash,
   * modelId) intentionally stay UNSET — the session_end handler
   * provides them at flush time per SessionLogger's late-bind contract.
   */
  getOrCreate(sessionId: string): SessionLogger {
    let logger = this.loggers.get(sessionId);
    if (logger === undefined) {
      logger = new SessionLogger(sessionId, this.storageClient);
      this.loggers.set(sessionId, logger);
    }
    return logger;
  }

  /** True iff a SessionLogger has already been allocated for sessionId. */
  has(sessionId: string): boolean {
    return this.loggers.has(sessionId);
  }

  /**
   * Drop the SessionLogger reference. Called from session_end AFTER
   * flush+mint completes (or after the failure path — we don't want
   * sealed loggers staying in the map and leaking memory across a
   * long-running OpenClaw process).
   */
  release(sessionId: string): void {
    this.loggers.delete(sessionId);
  }

  /**
   * Atomic remove-and-return — the "one agent task = one token" rotate
   * primitive (v0.3.4). Returns the bound SessionLogger AND immediately
   * unbinds it from `sessionId` in the same synchronous tick, so the
   * NEXT `message_received` on the same sessionId allocates a FRESH
   * logger instead of getting the one we're about to flush.
   *
   * Why a single atomic primitive vs. `getOrCreate` + `release`: the
   * anchor body is async (upload + mint + commit takes seconds). If a
   * new `message_received` lands during that window, the old non-atomic
   * pair would race: the new hook calls `getOrCreate(sessionKey)` and
   * gets the SAME logger that the anchor is about to flush, then
   * `SessionLogger.appendEntry()` rejects on the now-flushing logger
   * and the new turn's entry is silently lost. With this single call,
   * the rotate is a one-tick map mutation that happens before any
   * `await` — JS event-loop guarantees no other hook interleaves.
   *
   * Returns null when no logger is bound (a defensive check; callers
   * typically gate on `has(sessionId)` first to short-circuit).
   */
  takeAndRelease(sessionId: string): SessionLogger | null {
    const existing = this.loggers.get(sessionId);
    if (existing === undefined) return null;
    this.loggers.delete(sessionId);
    return existing;
  }

  /** Test/diagnostic helper: count of currently-tracked sessions. */
  size(): number {
    return this.loggers.size;
  }
}
