# Story: session-logger

**Epic:** Epic 1 — Execution Logger Core  
**Estimated time:** ~2h  
**Dependencies:** story-log-schema, story-storage-client

---

## Narrative

As a logger developer, I need a SessionLogger class that accumulates tool call entries during an OpenClaw session and flushes them to 0G Storage at session end.

---

## Acceptance criteria

```gherkin
Given SessionLogger is imported from `packages/logger/src/SessionLogger.ts`
When new SessionLogger(sessionId: string, storageClient: StorageClient) is instantiated
Then it initializes with empty entries array and correct sessionId

Given a SessionLogger instance with 3 appendEntry() calls made
And each entry has distinct seq, ts, tool, inputHash, outputHash
When flush() is called
Then it returns LogFlushResult with { rootHash, entryCount: 3, sessionId }
And rootHash is a valid bytes32 hex string

Given append(entry) is called with invalid ExecutionLogEntry (missing required fields)
When it is parsed with Zod schema
Then validation fails and an error is thrown (not silently ignored)

Given pnpm test is run in packages/logger
Then at least 15 behavioral test cases pass
And pnpm test --coverage shows >= 80% line coverage on SessionLogger class
```

---

## File modification map

**Create:**
- `packages/logger/src/SessionLogger.ts` — Class with appendEntry(), flush(), getEntries(), getStatus() methods
- `packages/logger/tests/session-logger.test.ts` — ≥15 test cases covering: instantiation, append, validation, flush, edge cases (empty session, large entry count)

**Update:**
- `packages/logger/src/index.ts` — Export SessionLogger, LogFlushResult
- `packages/logger/package.json` — Ensure vitest configured

---

## Shell verification

```bash
# Run tests:
pnpm --filter=logger vitest run --reporter=verbose 2>&1 | grep -E "PASS|FAIL" | wc -l
# Must be >= 15

# Coverage check:
pnpm --filter=logger vitest run --coverage 2>&1 | grep -A2 "session-logger.ts" | grep -oE "[0-9]+\.[0-9]+%" | head -1
# Must be >= 80%
```
