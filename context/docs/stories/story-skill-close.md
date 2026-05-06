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

> **Spec evolution**: the package lives at
> `openclaw-skills/verifiable-execution/` (NOT
> `packages/openclaw-skill/`). The hook is registered as
> `api.on("session_end", handler)`. SessionManager already had
> `release(sessionKey)` from skill-init scope (renamed from the
> story's `removeActiveLogger`). The handler is `handleSessionEnd`
> exported from `src/index.ts`.
>
> The hook returns void per the OpenClaw contract (the agent doesn't
> see a return value); the `{verifyUrl, tokenId, txHash}` payload
> surfaces in the structured log line at level INFO. A dashboard /
> verifier UI / log shipper picks it up from there.

**Update:**
- `openclaw-skills/verifiable-execution/src/index.ts` — Replace the skill-init stub `onSessionEndStub` with real `handleSessionEnd` that:
  - Looks up the SessionLogger in `state.sessions`
  - If absent (zero tool calls happened), INFO-logs "skipping anchor" and returns
  - Builds containerHash deterministically from `sessionKey + agentId` (synthetic — see "Spec evolution" below)
  - Sets late-bind metadata + flushes via the logger
  - Builds a SessionAnchor and calls `anchor()`
  - On success: INFO-logs full verifyUrl (`config.verifyUrlBase` + relative `/verify/<chainId>/<tokenId>`)
  - On failure: ERROR-logs structured failure including `rootHash` from `SessionAnchorMintAfterFlushError` (so operators can manually `retryMint()`)
  - Always calls `state.sessions.release(sessionKey)` in `finally` so the SessionLogger doesn't leak across long-running OpenClaw processes
- `openclaw-skills/verifiable-execution/tests/skill.test.ts` — Add the `handleSessionEnd` test suite (6 new tests: happy path with full verifyUrl assembly + release, no-op when zero tool calls, release after mint failure, rootHash captured in error log for retry, missing sessionKey safe-skip, trailing-slash on verifyUrlBase normalized).

---

## Shell verification

```bash
# Use the SCOPED package name + `exec vitest`. Tests for skill-close
# live in skill.test.ts (single file across all 3 Epic 4 stories):
pnpm --filter @verifiable-agent-execution/openclaw-skill exec vitest run skill.test.ts
# Must exit 0. Expect 26 tests passing total in skill.test.ts.
```

### Spec evolution — containerHash is a synthetic, not a TEE attestation

The session-mint BDD says containerHash is "the OpenClaw container
hash captured at session end". OpenClaw doesn't expose a
hardware-attested TEE container hash today. The plugin derives a
deterministic synthetic in `deriveContainerHash`:

```
containerHash = "0x" + sha256("openclaw-session:" + sessionKey + ":" + agentId)
```

This is sufficient for the AgenticID anchor (which doesn't
cryptographically validate containerHash semantics — that's Epic 5
verifier scope), and lets any third party re-derive the hash from
public session metadata. When OpenClaw exposes a real TEE attestation
we swap the synthetic for the attestation hash; same bytes32 slot,
no schema change.