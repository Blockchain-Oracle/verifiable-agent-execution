# Story: log-schema

**Epic:** Epic 1 — Execution Logger Core  
**Estimated time:** ~1h  
**Dependencies:** None

---

## Narrative

As a logger developer, I need well-typed execution log entry structures so that tool calls can be accumulated and validated without runtime errors.

---

## Acceptance criteria

```gherkin
Given the package `packages/logger/` exists
When `pnpm add zod` is run in the logger package
And `packages/logger/src/types.ts` is created with TypeScript type definitions for:
  - ExecutionLogEntry (seq, ts, type, tool, modelId, inputHash, outputHash, teeSignature, agentId, sealId)
  - SessionLog (sessionId, startedAt, endedAt, agentId, containerHash, modelId, entries[], entryCount)
  - LogFlushResult (rootHash, entryCount, sessionId)
  - Zod schemas for runtime validation of each type
Then `pnpm tsc --noEmit` exits with code 0
And `pnpm vitest run types.test.ts` passes (if test exists)
And all three types export from `packages/logger/src/index.ts`

Given a test file that imports ExecutionLogEntry and creates a valid instance
When `zod.parse(ExecutionLogEntry, {seq: 0, ts: Date.now(), ...})` is called
Then it returns the parsed object without error
```

---

## File modification map

**Create these files (new):**
- `packages/logger/src/types.ts` — All three TypeScript interfaces + Zod schemas
- `packages/logger/src/index.ts` — Export all types from types.ts
- `packages/logger/package.json` — Configure zod dependency

**Update:**
- `packages/logger/tsconfig.json` — Ensure strict mode enabled
- `pnpm-workspace.yaml` — Register logger package if needed

---

## Shell verification

```bash
# In repo root:
pnpm tsc --noEmit
# Exit code must be 0

# Run type-checking tests if added:
pnpm --filter=logger vitest run types.test.ts 2>/dev/null | grep -E "passed|failed" | head -1
```
