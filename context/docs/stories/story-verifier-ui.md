# Story: verifier-ui

**Epic:** Epic 5 — Verification Dashboard  
**Estimated time:** ~2h  
**Dependencies:** story-verifier-api

---

## Narrative

As a judge-facing frontend developer, I need a proof-chain UI that renders the anchored session metadata, entries, and verification badge so anyone can inspect the agent proof without a wallet.

---

## Acceptance criteria

```gherkin
Given `apps/dashboard/src/app/verify/[tokenId]/page.tsx` is created
And it loads proof data from `/api/verify/[tokenId]`
When the page is opened at `/verify/42`
Then it renders the session metadata section
And it renders at least 1 log entry card
And it renders a verification badge with one of: Verified, Mock, Unverified

Given the page is loading
When the API has not returned yet
Then at least 4 skeleton cards or shimmer placeholders are visible
And the page does not flash unstyled content

Given the page receives an API response with verified=true
When the badge renders
Then it includes the text `TEE Verified`
And the status color is green
```

---

## File modification map

**Create:**
- `apps/dashboard/src/app/verify/[tokenId]/page.tsx` — proof-chain page
- `apps/dashboard/src/components/ProofChain.tsx` — main proof container
- `apps/dashboard/src/components/LogEntry.tsx` — individual log card
- `apps/dashboard/src/components/StatusBadge.tsx` — verification status badge
- `apps/dashboard/src/components/Skeleton.tsx` — loading placeholders
- `apps/dashboard/tests/verifier-ui.test.tsx` — render tests for loading, success, error states

**Update:**
- `apps/dashboard/src/app/layout.tsx` — dark theme + Geist imports
- `apps/dashboard/src/lib/client.ts` — proof fetch helper if needed

---

## Shell verification

```bash
pnpm --filter=dashboard vitest run verifier-ui.test.tsx
pnpm --filter=dashboard next build
# Both must exit 0
```