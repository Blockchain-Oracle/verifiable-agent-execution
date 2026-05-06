# Story: skill-intercept

**Epic:** Epic 4 — OpenClaw Skill  
**Estimated time:** ~1.5h  
**Dependencies:** story-log-schema, story-skill-init

---

## Narrative

As an OpenClaw integration developer, I need onToolCall to intercept every tool execution and append an ExecutionLogEntry to the SessionLogger, capturing inputs, outputs, and TEE metadata.

---

## Acceptance criteria

```gherkin
Given onToolCall(context, toolName, input, output) is implemented
And SessionManager has an active SessionLogger for the session
When a tool call (e.g., web_search, summarize) completes
Then onToolCall is invoked with the tool name and I/O
And SessionLogger.appendEntry() is called with:
  - seq: incrementing from 0
  - ts: current Unix timestamp ms
  - type: 'tool_call'
  - tool: toolName
  - inputHash: sha256(JSON.stringify(input))
  - outputHash: sha256(JSON.stringify(output))

Given 3 tool calls are executed in a session
When the session is inspected mid-run
Then SessionLogger has 3 entries in order

Given onToolCall encounters an error (e.g., invalid input)
When the error is caught
Then a log entry is still created (with error flag or type='tool_error')
And the error does not crash the session
```

---

## File modification map

> **Spec evolution (post story-skill-init layout fix)**: the package
> lives at `openclaw-skills/verifiable-execution/` (NOT
> `packages/openclaw-skill/`) per the canonical OpenClaw layout. The
> `onToolCall` hook is registered as `api.on("after_tool_call", handler)`,
> NOT a top-level `onToolCall` method on the api. Handler is exported as
> `handleAfterToolCall(state, event, ctx)` from `src/index.ts` so tests
> can drive it without a full OpenClaw runtime.

**Create:**
- `openclaw-skills/verifiable-execution/src/hash.ts` — `sha256Hex(value)` helper using node:crypto

**Update:**
- `openclaw-skills/verifiable-execution/src/index.ts` — Replace the skill-init stub `onToolCallStub` with real `handleAfterToolCall` that hashes inputs/outputs and calls SessionLogger.appendEntry. Lazy-allocate SessionLogger via `state.sessions.getOrCreate(sessionKey)` (no api.getActiveLogger needed — the SessionManager IS the access point).
- `openclaw-skills/verifiable-execution/tests/skill.test.ts` — Add the handleAfterToolCall test suite (6 new tests covering: shape of single entry, 3-sequential monotonic seq, tool-error captured in outputHash via {error} envelope, missing sessionKey safe-skip, sessionId fallback, missing toolName fallback to "&lt;unknown&gt;").

---

## Shell verification

```bash
# Use the SCOPED package name + `exec vitest` (bare `--filter=openclaw-skill`
# does NOT match the workspace package id, which is
# `@verifiable-agent-execution/openclaw-skill`):
pnpm --filter @verifiable-agent-execution/openclaw-skill exec vitest run skill.test.ts
# Must exit 0. Expect 26 tests passing total in skill.test.ts (skill-init: 14,
# skill-intercept: 6, skill-close: 6).
```

### Spec evolution — type "tool_error" not in logger schema

The original BDD said failed tool calls should produce an entry with
`type: 'tool_error'` (or an error flag). The deployed
`ExecutionLogEntry` schema in `packages/logger/src/types.ts` only
exposes types `tool_call | inference | session_start | session_end` —
no `tool_error`. Cross-package schema change for one variant is
heavyweight.

The non-invasive equivalent (implemented in `handleAfterToolCall`):
when `event.error` is present, log the entry as `type: 'tool_call'`
but compute `outputHash = sha256Hex({error: serializeError(err)})`.
The error envelope is deterministic (excludes stack traces so the
hash stays stable across runtimes), and downstream verifiers see
SOMETHING captured for the failure rather than an inferred gap in the
proof chain. If a future epic needs to distinguish errors at query
time, adding the variant becomes a tractable schema migration.
