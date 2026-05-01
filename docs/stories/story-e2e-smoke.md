# Story: e2e-smoke

**Epic:** Epic 5 — Verification Dashboard  
**Estimated time:** ~1h  
**Dependencies:** story-skill-close, story-verifier-api

---

## Narrative

As the release integrator, I need one end-to-end smoke test that proves the OpenClaw session, on-chain anchor, storage lookup, and verification UI are wired together on real infrastructure.

---

## Acceptance criteria

```gherkin
Given the dashboard app and OpenClaw skill are configured with Galileo testnet environment variables
When `pnpm test:e2e` is run from the repo root
Then it completes successfully
And it prints a tokenId
And a GET request to `/api/verify/{tokenId}` returns HTTP 200
And the response includes `verified: true` or `verified: false` with a non-empty entries array

Given the e2e smoke test replays a real anchored session
When the proof is resolved
Then the rootHash matches the storage record
And the UI snapshot assertion finds the proof chain page elements
```

---

## File modification map

**Create:**
- `tests/e2e-smoke.test.ts` — repository-level smoke test for full flow
- `tests/fixtures/anchored-session.json` — fixture metadata for a real anchored session
- `tests/fixtures/verify-response.json` — expected response shape snapshot

**Update:**
- `package.json` — add `test:e2e` script
- `README.md` — document the smoke test command and required env vars

---

## Shell verification

```bash
pnpm test:e2e
# Must exit 0
```