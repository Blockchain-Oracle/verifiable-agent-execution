# Story: verifier-api

**Epic:** Epic 5 — Verification Dashboard  
**Estimated time:** ~1.5h  
**Dependencies:** story-session-mint, story-tee-proof-flow

---

## Narrative

As a dashboard developer, I need a verification API that resolves a token ID into session metadata, storage content, and proof status so the UI can render a single trustworthy proof view.

---

## Acceptance criteria

```gherkin
Given `apps/dashboard/src/app/api/verify/[tokenId]/route.ts` is created
And the route can read chain + storage configuration from environment variables
When a valid GET request is sent to `/api/verify/42`
Then it returns HTTP 200
And the JSON body contains:
  - tokenId
  - sessionId
  - rootHash
  - entryCount
  - verified
  - entries[]

Given `/api/verify/[tokenId]` receives a tokenId that does not exist
When the request is executed
Then it returns HTTP 404
And the response body includes a machine-readable error code

Given a stored session log contains at least 1 tool_call entry
When the API resolves the proof chain
Then `entries.length >= 1`
And at least one entry includes tool, ts, inputHash, and outputHash fields
```

---

## File modification map

**Create:**
- `apps/dashboard/src/app/api/verify/[tokenId]/route.ts` — GET endpoint for proof resolution
- `apps/dashboard/src/lib/verify-proof.ts` — helper for chain/storage/proof lookup
- `apps/dashboard/tests/verifier-api.test.ts` — API tests for success, not found, malformed response

**Update:**
- `apps/dashboard/src/lib/client.ts` — add fetch wrapper for verify endpoint calls

---

## Shell verification

```bash
pnpm --filter=dashboard vitest run verifier-api.test.ts
# Must exit 0
```