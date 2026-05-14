# story-v0.3.4-one-task-one-token

**Branch:** v0.3.0-private-receipts (continuing on the same branch)
**Source of truth:** `.claude/plans/v0.3.4-one-task-one-token.md` (Codex-approved after 8 rounds of design review on 2026-05-14)
**Trigger:** Abu's 2026-05-13 feedback that the verifiable-execution plugin was minting MULTIPLE tokens per logical agent task ("for a token now maybe ... For each particular task, a single tax, everything in one place") — the BDD audit unit should be ONE user message → ONE on-chain token.

## Why this story

`handleAgentEnd` was a one-line delegation to `handleSessionEnd` (`src/index.ts:1054-1059` pre-v0.3.4), so anchors fired on BOTH `agent_end` AND `session_end` hooks. On every channel that emits both (Telegram, Discord) — that's two tokens for one user message. Audit stories fragmented across tokens, feed inflation, and the dashboard had no way to tell apart the "real" anchor from the duplicate.

The fix: anchor only on `agent_end` (the BDD unit per `openclaw@2026.5.4 hook-types.ts:277`), reduce `session_end` to an ORPHAN-RECOVERY branch that only mints when `agent_end` never fired and entries are still in memory.

## Architectural changes (per approved plan)

The plan (`.claude/plans/v0.3.4-one-task-one-token.md`) is the canonical spec; this story enumerates the BDD acceptance lines that codex-review.sh must check against.

### Foundation
- `SessionManager.takeAndRelease(sessionKey)`: atomic remove-and-return primitive.
- `PluginState.pendingAnchors: Map<pendingKeyName, SessionLogger>`: retry registry, strictly bounded to UN-flushed loggers (cleared on mint success AND on `SessionAnchorMintAfterFlushError`).

### Keystore
- `setPending(pendingKeyName, key, meta?: {sessionKey, runId})`: decoupled filesystem identity from operator-visible identity.
- `commitPending(pendingKeyName, tokenId, meta?: {sessionKey, runId})`: same decoupling; `last-receipt.json` stores BARE `sessionKey` + `runId` (NOT the compound `pendingKeyName`).
- `listPending()`: returns `{sessionKey, runId, sanitizedFilename, createdAt}` — bare sessionKey, runId in its own field.

### SessionAnchor
- `AnchorInput.dataDescriptionPrefix?: string` (default `"exec-log"`); orphan-recovery passes `"exec-log-orphan"`.
- `retryMint({...dataDescriptionPrefix})`: same prefix support on recovery path.
- `SessionAnchorMintAfterFlushError.dataDescriptionPrefix`: carries prefix so the post-flush retry preserves it.

### Plugin handlers
- `handleAgentEnd`: PRIMARY anchor body. Sequence:
  1. takeAndRelease(sessionKey) → logger (or no-op if null)
  2. generate K + pendingKeyName = `${sessionKey}|run:${runId}`
  3. keystore.setPending — synchronous
  4. state.pendingAnchors.set — synchronous; registry holds un-flushed logger
  5. anchor.anchor({dataDescriptionPrefix:"exec-log", encrypt}) — async
  6. pendingAnchors.delete on success OR on SessionAnchorMintAfterFlushError
  7. keystore.commitPending — separate try/catch (round-6 split)
- `handleSessionEnd`: ORPHAN-RECOVERY branch only. takeAndRelease; if non-null, anchor with `exec-log-orphan:` prefix and ERROR-level log "Orphan recovery anchor — agent_end never fired".

### Dashboard
- New `apps/dashboard/src/lib/exec-log-parser.ts`:
  - `isExecutionLogDescription(s)` — true for `exec-log:` OR `exec-log-orphan:`.
  - `parseExecutionLogDescription(s)` — returns `{sessionId, modelId, recoveryAnchor}` using `lastIndexOf(":")` (preserves colon-in-sessionId fix from round-4).
- All 5 callsites updated (`verify-proof.ts` lines 290, 363, 505, 649 + `feed.ts:307`).
- `ProofResponse.meta.recoveryAnchor: boolean` added.
- `FeedRow.recoveryAnchor: boolean` added.
- `SessionView` + `FeedTable` render a "Recovery" / "Orphan recovery anchor" badge when true.

## BDD acceptance criteria

### v0.3.4-1 — One agent_end = one token (primary anchor)
**Given** a session with one or more accumulated entries
**When** `handleAgentEnd(state, {runId, messages, success}, {sessionKey})` fires
**Then** exactly one token mints with `dataDescription` starting with `exec-log:` (NOT `exec-log-orphan:`)
**And** `state.sessions.has(sessionKey) === false` after the call (atomic rotate ran).

### v0.3.4-2 — Atomic rotate isolates the next turn
**Given** an agent_end just anchored a logger for `sessionKey`
**When** a new `handleAfterToolCall(sessionKey, ...)` fires
**Then** `SessionManager.getOrCreate(sessionKey)` returns a FRESH SessionLogger (different instance)
**And** that fresh logger's `entryCount` starts at 0 — old entries don't carry over.

### v0.3.4-3 — runId source-of-truth
**Given** `event.runId === "run-explicit-123"`
**When** handleAgentEnd fires
**Then** the success structured-log line includes `"runId":"run-explicit-123"` (NOT a synthetic).
**And When** `event.runId` is missing
**Then** the structured-log line includes `"runId":"anon-<32-hex>"` (16 bytes of entropy).

### v0.3.4-4 — session_end no-op when no orphan
**Given** handleAgentEnd already anchored and cleared `state.sessions` for `sessionKey`
**When** `handleSessionEnd(state, _, {sessionKey})` fires (channel close)
**Then** NO additional mint happens.

### v0.3.4-5 — session_end orphan recovery
**Given** `state.sessions.has(sessionKey) === true` (agent_end never fired; harness crashed mid-run)
**When** `handleSessionEnd(state, _, {sessionKey})` fires
**Then** exactly one token mints with `dataDescription` starting with `exec-log-orphan:`
**And** an ERROR-level structured-log line records "Orphan recovery anchor — agent_end never fired".

### v0.3.4-6 — No double-mint on concurrent agent_end + session_end
**Given** an active SessionLogger for `sessionKey`
**When** `handleAgentEnd` and `handleSessionEnd` are awaited via `Promise.all`
**Then** exactly ONE token mints (atomic takeAndRelease prevents the second handler from re-anchoring the same logger).

### v0.3.4-7 — pendingAnchors registry: flush-failure retention
**Given** the upload layer throws (flush fails)
**When** handleAgentEnd runs
**Then** `state.pendingAnchors.size === 1`
**And** the key is `${sessionKey}|run:${runId}` (the compound pendingKeyName).
**And** the registered logger has not been GC'd — operator can manually flush+mint+commit using the structured-log recovery hint.

### v0.3.4-8 — pendingAnchors registry: cleared on mint success
**Given** a successful anchor (flush + mint both succeeded)
**When** handleAgentEnd returns
**Then** `state.pendingAnchors.size === 0` (the encrypted bytes are durable on 0G Storage; the plaintext logger is no longer needed for recovery).

### v0.3.4-9 — pendingAnchors registry: cleared on post-flush mint failure
**Given** flush succeeded but mint threw (SessionAnchorMintAfterFlushError)
**When** handleAgentEnd returns
**Then** `state.pendingAnchors.size === 0`
**And** the error's `dataDescriptionPrefix` is on the structured-log line so the operator's `retryMint(...)` call can preserve it.

### v0.3.4-10 — Keystore metadata bag decouples pendingKeyName from sessionKey
**Given** `setPending("a|run:x", K, {sessionKey:"a", runId:"x"})`
**When** `listPending()` is called
**Then** the entry has `sessionKey === "a"`, `runId === "x"` (BARE), and `sanitizedFilename === base64url("a|run:x")` (COMPOUND).

### v0.3.4-11 — Keystore commitPending writes bare sessionKey to last-receipt.json
**Given** `commitPending("a|run:x", "42", {sessionKey:"a", runId:"x"})` succeeds
**When** `getLast()` is called
**Then** `pointer.sessionKey === "a"` (NOT `"a|run:x"`)
**And** `pointer.runId === "x"`.

### v0.3.4-12 — Two concurrent runs on same sessionKey do NOT collide
**Given** two setPending calls with the same `sessionKey` but different `runId`
**When** both commit to distinct tokenIds
**Then** each tokenId binds its OWN AES key (no cross-binding leak).

### v0.3.4-13 — SessionAnchor dataDescriptionPrefix
**Given** `anchor({dataDescriptionPrefix:"exec-log-orphan", ...})`
**When** mint is called
**Then** `mint.datas[0].dataDescription === "exec-log-orphan:<sessionId>:<modelId>"` (NOT `exec-log:`).
**And** `SessionAnchorMintAfterFlushError.dataDescriptionPrefix === "exec-log-orphan"`.
**And** retryMint({dataDescriptionPrefix:"exec-log-orphan", ...}) honors the prefix on retry.

### v0.3.4-14 — Centralized exec-log-parser
**Given** `parseExecutionLogDescription("exec-log-orphan:agent:core:telegram:direct:802:claude")`
**When** parsed
**Then** returns `{sessionId:"agent:core:telegram:direct:802", modelId:"claude", recoveryAnchor:true}` (preserves Codex round-4 colon-in-sessionId fix).
**And** `parseExecutionLogDescription("exec-log:abc:claude")` returns `{sessionId:"abc", modelId:"claude", recoveryAnchor:false}`.
**And** malformed inputs return `null` (NOT throw).
**And** `isExecutionLogDescription("exec-log-orphan:...")` returns `true` — longer-prefix-first precedence prevents misclassification.

### v0.3.4-15 — Dashboard recoveryAnchor surface
**Given** a token minted with `exec-log-orphan:` prefix
**When** ProofResponse is built
**Then** `proof.meta.recoveryAnchor === true`
**And** SessionView renders an "Orphan recovery anchor" badge in the metadata column.
**And** FeedTable renders a small "Recovery" badge in the row's Status column.

## Files modified

| File | Change |
|---|---|
| `openclaw-skills/.../src/SessionManager.ts` | + `takeAndRelease()` |
| `openclaw-skills/.../src/index.ts` | + `pendingAnchors` on PluginState; new `anchorRun()` helper; `handleAgentEnd` is now primary anchor; `handleSessionEnd` is now orphan-recovery only |
| `openclaw-skills/.../src/keystore.ts` | `setPending`/`commitPending` take optional `meta` bag; `listPending()` returns `{sessionKey, runId, ...}`; `LastReceiptPointer.runId?` |
| `packages/chain-client/src/SessionAnchor.ts` | `AnchorInput.dataDescriptionPrefix?`; `retryMint({dataDescriptionPrefix?})`; `mintAndBuildResult` parameterized |
| `packages/chain-client/src/errors.ts` | `SessionAnchorMintAfterFlushError.dataDescriptionPrefix` |
| `apps/dashboard/src/lib/exec-log-parser.ts` | **NEW** — `isExecutionLogDescription`, `parseExecutionLogDescription` |
| `apps/dashboard/src/lib/verify-proof.ts` | 4 callsites replaced; deleted `parseSessionIdFromDescription`; `meta.recoveryAnchor` added |
| `apps/dashboard/src/lib/feed.ts` | 1 callsite + split-bug refactor; `FeedRow.recoveryAnchor` added |
| `apps/dashboard/src/components/SessionView.tsx` | "Orphan recovery anchor" badge row |
| `apps/dashboard/src/components/FeedTable.tsx` | "Recovery" badge |
| `apps/dashboard/tests/exec-log-parser.test.ts` | **NEW** — 13 parser tests |
| `openclaw-skills/.../tests/skill.test.ts` | + v0.3.4 BDD suite (~14 tests); updated 2 primary-anchor tests to use `handleAgentEnd` |
| `openclaw-skills/.../tests/keystore.test.ts` | + v0.3.4 metadata-bag tests (4 tests) |
| `packages/chain-client/tests/session-anchor.test.ts` | + 4 dataDescriptionPrefix tests |

## Shell verification

```bash
pnpm exec tsc --noEmit && pnpm run lint && pnpm test && pnpm run build
```

Then run the inline §14 grep gate from CLAUDE.md (`HOT_PATHS=(...); grep -rEl --exclude='Mock*.sol' 'mock|fake|dummy|hardcoded' "${EXISTING[@]}"`). No wrapper script — the gate is short enough to live inline so it stays close to the rule it enforces.

All checks must pass before this story is "done."
