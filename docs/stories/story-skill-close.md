# Story: skill-close

**Epic:** Epic 4 — OpenClaw Skill  
**Estimated time:** ~1.5h  
**Dependencies:** story-session-mint, story-skill-intercept

---

## Narrative

As an OpenClaw integration developer, I need onSessionEnd to flush the active session log, anchor it on-chain, and return a verifyUrl so the session can end with a permanent proof link.

---

## Acceptance criteria

```gherkin
Given `packages/openclaw-skill/src/hooks.ts` exports onSessionEnd(context)
And SessionManager has an active SessionLogger with at least 1 entry
When onSessionEnd(context) is called
Then it calls SessionLogger.flush() exactly once
And it calls SessionAnchor.anchor() exactly once
And it returns { verifyUrl: string, tokenId: bigint, txHash: string }

Given onSessionEnd() resolves successfully
When the session state is inspected afterward
Then SessionManager no longer has an active logger for that session
And a completion message includes the verifyUrl

Given SessionAnchor.anchor() throws an error
When onSessionEnd() is called
Then the error is caught and surfaced as a structured failure
And the session does not leave a dangling active logger behind
```

---

## File modification map

**Create:**
- `packages/openclaw-skill/src/hooks.ts` — onSessionEnd implementation that flushes + anchors
- `packages/openclaw-skill/tests/skill-close.test.ts` — Tests success path, cleanup, anchor failure path

**Update:**
- `packages/openclaw-skill/src/index.ts` — Export onSessionEnd from hooks
- `packages/openclaw-skill/src/SessionManager.ts` — Add cleanup/removeActiveLogger(sessionId)

---

## Shell verification

```bash
pnpm --filter=openclaw-skill vitest run skill-close.test.ts
# Must exit 0 with all tests passing
```