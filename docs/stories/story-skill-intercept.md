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

**Create:**
- `packages/openclaw-skill/src/hooks.ts` — onToolCall implementation with input/output hashing
- `packages/openclaw-skill/tests/skill.test.ts` — Test 3 sequential tool calls, verify entries logged in order, error handling

**Update:**
- `packages/openclaw-skill/src/index.ts` — Wire onToolCall into skill exports
- `packages/openclaw-skill/src/SessionManager.ts` — Add getActiveLogger() method for hook access

---

## Shell verification

```bash
# Run skill tests:
pnpm --filter=openclaw-skill vitest run skill.test.ts
# Must exit 0 with >= 5 passing tests
```
