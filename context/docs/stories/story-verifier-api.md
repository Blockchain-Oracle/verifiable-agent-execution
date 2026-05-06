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
# Use the SCOPED package name + `exec vitest` (bare `--filter=dashboard`
# does NOT match the workspace package id, which is
# `@verifiable-agent-execution/dashboard`):
pnpm --filter @verifiable-agent-execution/dashboard exec vitest run verifier-api.test.ts verifier-route.test.ts
# Must exit 0. Library tests live in verifier-api.test.ts; HTTP route
# integration tests live in verifier-route.test.ts (covers GET status
# codes + response body shape per BDD).
```

### Spec evolution — verified is a 3-state, not a boolean; HTTP route tests live in a separate file

Original BDD said `verified: boolean`. The implementation uses
`"verified" | "preview" | "unverified"` because the UX spec badge has
three colors (green/amber/red) — "preview" is the additional state
for dev sessions (no signatures present) and pre-verifier-deploy
environments (TEE_VERIFIER_ADDRESS unset). The boolean reading maps
to "verified" | "unverified".

Original BDD's "When a valid GET request is sent to /api/verify/42 then
HTTP 200" was caught by tests/verifier-api.test.ts which targets
`resolveProof` directly — those tests don't exercise the HTTP boundary.
Codex caught the gap; tests/verifier-route.test.ts now imports the
route's `GET` export and invokes it with a synthetic Request, asserting
HTTP status + response body shape per the BDD.

The dashboard library uses `Indexer.downloadToBlob(rootHash, {proof:true})`
directly rather than the StorageClient from `packages/logger`, because
StorageClient's constructor requires a Signer for the upload path —
the dashboard is read-only and constructing a placeholder Wallet
violates the §14 hot-path no-hardcoded-secrets rule (Codex web R1 P2).