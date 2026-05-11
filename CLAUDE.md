# CLAUDE.md — verifiable-agent-execution

_Updated: 2026-05-05. Managed by sahil-coding-protocol._

## What this is

**"Etherscan for AI agents — share a URL, verify any agent run cold."**
The 0G APAC Hackathon 2026 entry on **Track 1 (Agentic Infrastructure & OpenClaw Lab)** — a primitive that lets anyone prove an AI agent ran exactly what it claimed. An OpenClaw plugin captures every tool call inside `agent-wrapper`'s TEE container, the session log is flushed to **0G Storage**, and an **iNFT (ERC-7857)** is minted on our **AgenticID at `0xd4a5eA…0E38` (Galileo testnet, Epic-7 OUR deploy)** anchoring the rootHash. A public verifier dashboard lets anyone hit the URL and run the proof chain (no wallet) — three live reads (`getIntelligentDatas` → 0G Storage download → `TEEVerifier.verifyTEESignature`) flip green checkmarks per row.

**Wedge:** GREEN lane in the gallery (no competitor in verifiable-audit-trail) per `context/06-hidden-field.md`. First-mover on 0G Private Computer (TEE), launched April 28. The architecture survived first-principles + SCAMPER passes (see `context/REFERENCE_REPO_AUDIT.md`); the wedge is honestly **TEE-rooted, not trustless** (ADR-10) and **speculative infrastructure for the agent economy emerging in 2026–2027**, framed as a defensible bet rather than a present-day pull.

**Frame as:** "Etherscan for AI agents" with a **reverse demo arc** (judge gets a URL cold, verifies a stranger's DeFi-swap simulation in 30 seconds, then we reveal what the agent did). PRD §"Demo moment" + ADR-11 + ADR-12 codify this.

**Never frame as:** "agent monitoring," "trace explorer," "fully trustless verification," or "AI compliance dashboard." Each loses the wedge.

**Deadline:** May 16, 2026 23:59 UTC+8. As of 2026-05-05, **11 days remain.** We **missed** the April 22 Hong Kong Mini Demo Day (a "key reference" per the brief) — the demo video must compensate.

## Stack

- **Language:** TypeScript (strict)
- **Package manager:** pnpm 9.15.4 workspace (never `npm` or `yarn`); `packageManager` field is enforced in `package.json`
- **Storage SDK:** `@0gfoundation/0g-storage-ts-sdk` v1.2.8 (the older `@0gfoundation/0g-ts-sdk` is **npm-deprecated** — every version redirects)
- **Compute SDK:** `@0gfoundation/0g-compute-ts-sdk` v0.8.0 (formerly `@0glabs/0g-serving-broker`, deprecated re-export shim)
- **Web3:** ethers ~6.13.1 (NOT v5; SDK peerDep is strict on this minor)
- **Contracts:** Solidity 0.8.24, Hardhat 2.22, **`evmVersion: "cancun"` is REQUIRED** (per `0g-agent-skills/patterns/CHAIN.md` — ADR-09)
- **OpenClaw plugin:** layout is `openclaw-skills/<id>/openclaw.plugin.json` + `src/index.ts` importing `OpenClawPluginApi` from `openclaw/plugin-sdk/core` (NOT `SKILL.md`)
- **UI framework:** Next.js 14 App Router
- **Styling:** Tailwind CSS + shadcn/ui (Trigger.dev anchor, see `context/docs/ux-spec.md`)
- **Testing:** Vitest (unit), Playwright @ 2% odiff (visual), Hardhat + chai (contracts)
- **Validation:** zod at I/O edges
- **Deploy target:** Vercel for `apps/dashboard/` (preview-on-PR via `vercel:bootstrap`); mainnet contract deploy via `pnpm hardhat run scripts/deploy-mock.ts --network 0g-mainnet`
- **Chains:**
  - Galileo testnet — chainId **16602**, RPC `https://evmrpc-testnet.0g.ai`, indexer `https://indexer-storage-testnet-turbo.0g.ai`, faucet `https://faucet.0g.ai` (0.1 0G/day), explorer `https://chainscan-galileo.0g.ai`
  - Mainnet (Aristotle) — chainId **16661**, RPC `https://evmrpc.0g.ai`, indexer `https://indexer-storage-turbo.0g.ai`, explorer `https://chainscan.0g.ai`
- **Galileo AgenticID (OURS, Epic-7):** `0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38` — `contracts/contracts/AgenticID.sol`, 1:1 from `agenticID-examples/01-mint-and-manage`. Deployed 2026-05-10 (block 32602466, tx 0x57802912cc803e0e1cdd8e88b104fba630c628ac62581804961718c1be5071bd). Demo session at tokenId 0.
- **Galileo MockTEEVerifier (OURS, Epic-7):** `0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad` — deployed 2026-05-10 with `teeOracleAddress` = deployer wallet (`0x3b56…33A3`). Block 32610650.
- **0G's pre-deployed example AgenticID (legacy):** `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on Galileo — still on-chain, original example contract per ADR-08. We no longer point at it; `lib/env.ts` defaults moved to our deploy in commit 929d6a6.
- **Mainnet (Aristotle) AgenticID:** `0xC6f7fB1511a7483C6e14258c70529e37ec698937` — deployed 2026-05-11 (block 32907005, tx 0x2f125874f4ef56a7e555baa0e8736f2b13cd7cdf03118b80e3f770ae16c5e636).
- **Mainnet (Aristotle) MockTEEVerifier:** `0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2` — deployed 2026-05-11 (block 32907019), oracle rotated to deployer wallet via `updateOracleAddress` (block 32907160).
- **Mainnet demo session:** tokenId 0, 5 entries (1 × 0G Compute TeeML inference + 4 × DeFi swap tool calls), rootHash 0xecb433f7b311cd5c4313035c156d42df153f0283391af73f4f297758cff3022c, mint tx 0xd1b14b30894a91e160e35b70e2f834920fe85d0cee8cc24e19f677b4dfb6d152.
- **TEE oracle (signing address, not a contract):** `0x04581d192d22510ced643eaced12ef169644811a` (hardcoded in `0g-agent-nft/scripts/deploy/deploy_tee.ts`)

## Top-3 commands

```bash
# Full local gate — run before every push.
pnpm install --frozen-lockfile && \
pnpm exec tsc --noEmit && \
pnpm run lint && pnpm test && pnpm run build

pnpm dev                                   # Next.js dev server (apps/dashboard, when it exists)
pnpm exec tsx scripts/smoke/<name>.ts      # re-runnable smoke tests under scripts/smoke/
```

The gate above is a 1:1 mirror of `.github/workflows/ci.yml` — if it passes locally, CI passes.

## Codex Flow (review discipline — non-negotiable)

This repo runs **dual-lab review** because same-lab review (Claude reviewing Claude) has correlated blind spots. Two touchpoints, one per side of the push:

1. **Pre-push (local):** before `gh pr create`, run a Codex review of the diff. Codex CLI is installed (`/opt/homebrew/bin/codex`).
   - **Use** `.claude/scripts/codex-review.sh <story-id>` — bundles the story BDD acceptance criteria into the prompt so Codex checks **semantic correctness against acceptance criteria**, not just generic bugs.
   - **Or fall back to** `codex exec review --base main --full-auto --title "<short title>" '<prompt>'` (non-interactive, sandbox approvals skipped).
   - **Do NOT** use `codex review` (top-level) — that's the TUI and it hangs in non-tty contexts.
   - Force binary verdicts + file:line citations + "find at least one substantive issue" framing in the prompt.
   - Address every valid finding before pushing.
2. **Post-push (GitHub):** **`chatgpt-codex-connector[bot]`** auto-reviews — but **only on initial PR open and on draft→ready transitions**. Subsequent pushes (follow-up commits, force-pushes) do NOT trigger an auto-review. To re-review a new head SHA you MUST post a `@codex review` comment on the PR yourself:
   ```bash
   gh pr comment <pr-number> --body "@codex review"
   ```
   If you push a fix and forget to tag, `codex-watch.sh` will keep showing "still pending" forever. Tag once per follow-up push. (Lesson learned the hard way on PR #17 + PR #18 of this repo.) Triage findings per `AGENTS.md`:
   - **Block-class** (missing tests, swallowed errors, mock/fake/dummy strings in hot path, hardcoded secrets, doc/code drift, BDD coverage gaps): **always fix.**
   - **Flag-class** (premature abstraction, narrating comments, BC shims): fix if cheap, otherwise reply "noted, deferring."
   - **Stylistic opinions** (naming, comment frequency): ignore unless obviously right. **"Codex is just an opinion, you are the developer."**
   - **Use `.claude/scripts/codex-watch.sh <pr-number>`** as the canonical way to surface Codex feedback. It hits all three relevant endpoints:
     - `/pulls/<n>/reviews` (headline)
     - `/pulls/<n>/comments` (per-line P1/P2/P3 — the meat)
     - `/issues/<n>/reactions` (eyes/+1)
     filtered by `chatgpt-codex-connector[bot]` and head SHA. `gh pr view` alone only shows the headline review; per-line findings are on a separate API and trivially missed without the script. Pass `--watch` to poll every 30s until the head SHA is reviewed.
   - **Bot reactions:** `eyes` = reviewing, `+1` = approved, comments = issues to triage.
3. After fixes, follow-up commit. Bot re-reviews on commit change.
4. **Never merge while CI red or Codex blockers open.**

## Hierarchy of truth — never invent an API signature

Hallucinated symbols are the most expensive error class on this repo (Codex catches them post-push, after the round-trip). **Look it up before writing.** Order of preference:

1. **`context/` folder** — repo-local, authoritative for THIS project. PRD, architecture (12 ADRs), ux-spec, story BDDs, sdk-snippets, sponsor-repos, SOURCE_OF_TRUTH.md, REFERENCE_REPO_AUDIT.md. **First stop, every time.**
2. **`scripts/smoke/*.ts`** — three re-runnable smoke tests that lock the actual SDK shape. If your code disagrees with these, your code is wrong (the smoke tests pass `tsc --noEmit` and `agenticid.ts` live-reads against Galileo).
3. **`/tmp/og-refs/`** — the five canonical 0G repos cloned during the outwards audit (`0g-storage-ts-starter-kit`, `agenticID-examples`, `agent-wrapper`, `0g-memory`, `0g-agent-skills`). Re-clone if missing — they're THE reference implementations.
4. **Installed package source** — `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/types/**/*.d.ts` and the package's `README.md`. Confirms real exports + return shapes.
5. **Context7 MCP** — `mcp__plugin_context7_context7__resolve-library-id` then `query-docs`. The `/websites/0g_ai` library is the live-rendered 0G docs site.
6. **Web search** — `tavily`, `exa:search`, `firecrawl:firecrawl`, `brave-api-search` for things not in Context7.

Pass this rule into every subagent brief. **"If you don't know, look it up — don't guess at an API."**

## Required external libraries (locked)

| Library | Purpose | Version | Status |
|---|---|---|---|
| `@0gfoundation/0g-storage-ts-sdk` | 0G Storage upload/download | ^1.2.8 | ✅ on `main` |
| `@0gfoundation/0g-compute-ts-sdk` | 0G Compute Network broker (renamed from `@0glabs/0g-serving-broker`) | ^0.8.0 | ✅ on `main` |
| `ethers` | EVM interactions | ~6.13.1 (strict — SDK peerDep) | ✅ on `main` |
| `@playwright/test` | Visual regression + anchor capture | ^1.48.2 | ✅ on `main` |
| `@types/node` | Node typings | ^20.14.10 | ✅ on `main` |
| `typescript` | Compiler | ^5.5.4 | ✅ on `main` |
| `zod` | Runtime schema validation | latest | pending Epic 1 |
| `hardhat` + `@nomicfoundation/hardhat-toolbox` | Compile + deploy | v2.22.x | pending Epic 2 |
| `@openzeppelin/contracts` | `ECDSA.recover` for `MockTEEVerifier` | latest | pending Epic 2 |
| `vitest` + `@testing-library/react` | Tests (per-package) | latest | pending Epic 1 |
| shadcn/ui primitives | UI (when Epic 5 lands) | latest | pending Epic 5 |

**Do NOT use** `@0gfoundation/0g-ts-sdk` (deprecated; redirects to `0g-storage-ts-sdk`), `@0glabs/0g-serving-broker` (deprecated re-export shim), ethers v5, or any package not in this table without an ADR justifying it.

## Rules for this repo (anti-slop list — grows with every burn)

**Hot-path source files** (`packages/logger/src/`, `packages/tee-adapter/src/`, `packages/chain-client/src/`, `openclaw-skills/verifiable-execution/src/`, `apps/dashboard/src/lib/`, `contracts/contracts/MockTEEVerifier.sol`):

- No `mock|fake|dummy|hardcoded` strings (§14 grep gate). Fixtures and recording adapters live under `__tests__/` and `__fixtures__/`.
- Contract addresses come from `.env` (loaded once at startup) — never hardcoded in a component.
- No fake on-chain calls. Real ethers reads/writes against Galileo (or the deployed mainnet contracts at submission).
- No swallowed errors (`catch (_) {}`, `|| true` on commands whose failure matters). Surface or log with reason.
- No fallbacks that silently disable mandatory functionality. Fail fast in production.
- 0G SDK calls return `[result, err]` tuples (Go-style) — destructure both, never `await` and assume throw.
- `MerkleTree.rootHash()` returns `string | null` — explicit null-check, do not coerce.

**UI** (per `context/docs/ux-spec.md`):

- Never `from-purple-500 to-pink-500`, `from-violet-* to-indigo-*`, or any default Tailwind purple gradient.
- Never `font-sans` without an explicit `next/font/google` import.
- Never `rounded-xl shadow-md` cards without explicit border-color.
- Never `text-gray-600` body on white. Use the UX-spec palette (Trigger.dev charcoal: bg `#15171A`, surface `#1A1B1F`, accent verify `#10B981`).
- Never "John Doe" / "Lorem ipsum" / "$1,234.56" / `ui-avatars.com` placeholders. Use real Galileo testnet addresses + realistic IntelligentData shapes.
- All shared client state goes through wagmi hooks (when added) or Zustand — never `useState` for connection / chain / balance state.

**Solidity:**

- Pragma `^0.8.24`. Compiler 0.8.24 with `evmVersion: "cancun"` (REQUIRED — ADR-09).
- `MockTEEVerifier.sol` mirrors the production `0g-agent-nft/contracts/TeeVerifier.sol` interface (`verifyTEESignature(bytes32, bytes calldata) external view returns (bool)`, `signature.length == 65` require, `"Invalid signature length"` revert string).
- All state reads are `view`. No gas on reads.
- No `iTransferFrom` or ERC-7857 ownership transfer mechanics (out of scope per PRD).

**Docs / config:**

- Every path mentioned in CLAUDE.md / READMEs / PR descriptions must resolve on the branch.
- Doc claims about scripts must match script behavior — verify before writing.
- Never commit `.env` or wallet keystores (gitignore enforces — `.env*` blocked, `.env.example` allowed).
- All `package.json` files include `"packageManager": "pnpm@9.15.4"` (CI requires it).

## §14 grep gate — hot-path verification

Run before every commit on a PR that adds or modifies hot-path source. Exits 0 when clean, 1 when a forbidden token is found.

```bash
HOT_PATHS=(
  packages/logger/src
  packages/tee-adapter/src
  packages/chain-client/src
  openclaw-skills/verifiable-execution/src
  apps/dashboard/src/lib
  contracts/contracts/MockTEEVerifier.sol
)
EXISTING=()
for p in "${HOT_PATHS[@]}"; do [ -e "$p" ] && EXISTING+=("$p"); done

if [ ${#EXISTING[@]} -eq 0 ]; then
  echo "§14 grep gate: no hot-path files yet — clean."
  exit 0
fi

set +e
# Exempt: canonical dev verifier whose NAME ("Mock*") is load-bearing per
# ADR-06. Any OTHER file in contracts/contracts/ matching `mock|fake|dummy|hardcoded`
# is still flagged — only the explicit Mock*.sol files at the top of
# contracts/contracts/ are skipped.
MATCHES=$(grep -rEl --exclude='Mock*.sol' 'mock|fake|dummy|hardcoded' "${EXISTING[@]}" 2>&1)
RC=$?
set -e

if [ $RC -eq 2 ]; then
  echo "§14 grep gate ERROR — grep failed to scan:" >&2
  echo "$MATCHES" >&2
  exit 2
fi
if [ $RC -eq 0 ] && [ -n "$MATCHES" ]; then
  echo "§14 grep gate FAIL — forbidden tokens in:" >&2
  echo "$MATCHES" >&2
  exit 1
fi
echo "§14 grep gate: clean."
```

Test fixtures under `__tests__/` and `__fixtures__/` are exempt. **Hot-path scope grows with the project** — when a new lib/hook/component lands that handles real on-chain data, add its path to the list above in the same PR.

## Burn list (the Codex / pitfalls log — pre-empt these)

Every entry below is a finding from prior projects (mezo-hack, kite-agent-firewall) or from our own audit. Treat as the standing trip-wire.

1. **Spec drift not caught till PR review.** Story files claimed APIs that didn't exist (`iMint` vs `mint`, `ZG-Res-Key` JSON envelope vs chatID string). **Fix forever:** the artifact-consistency audit (`SOURCE_OF_TRUTH.md`) + outwards audit (`REFERENCE_REPO_AUDIT.md`) + 3 smoke tests are the spec's proof of life. Any new SDK call must compile in a smoke test before the story is "done."
2. **Hand-rolled SDK types instead of importing real packages.** kite-agent-firewall hallucinated x402 types and built fake detection against them — caught only days into Phase 2. **Fix forever:** Hierarchy-of-truth rule above; `scripts/smoke/<name>.ts` is the proof.
3. **Skipping sponsor reference repos.** kite-agent-firewall built around a hallucinated Kite MCP shape; reality (Kite's MCP is a *wallet*, not a service registry) only emerged after live research. **Fix forever:** five 0G reference repos cloned to `/tmp/og-refs/` during the outwards audit; re-clone if missing.
4. **Doc paths that don't exist on the branch.** Codex flagged this on multiple prior PRs. **Fix forever:** every path mentioned in CLAUDE.md / README / PR body must resolve on the branch.
5. **`|| true` swallowing command errors.** **Fix forever:** removed; surface errors.
6. **OpenClaw plugin format hallucination.** We initially specified `SKILL.md` (Claude Code convention) when OpenClaw uses `openclaw.plugin.json` + `src/index.ts` (per `0g-memory/openclaw-skills/evermemos/`). **Fix forever:** ADR-04 + story-skill-init both call this out; `openclaw.plugin.json` only.
7. **`evmVersion` defaulted to non-cancun.** 0G Chain requires `evmVersion: "cancun"` for OZ `ECDSA.recover` — without it, deploy succeeds and runtime reverts with "invalid opcode." **Fix forever:** ADR-09 + story-tee-verifier-contract carry the requirement; never strip from `hardhat.config.ts`.
8. **Wrong package name (drift).** `@0gfoundation/0g-ts-sdk` is npm-deprecated (renamed to `@0gfoundation/0g-storage-ts-sdk`); `@0glabs/0g-serving-broker` is a deprecated re-export shim. **Fix forever:** "Required external libraries" table above is canonical; check it before adding any 0G dep.

## BDD acceptance criteria

Story BDDs live in `context/docs/stories/story-<id>.md`. For each story:

1. Read the Given/When/Then. Cross-check against `context/docs/PRD.md` + `context/docs/ux-spec.md` for product framing.
2. Write tests FIRST (ATDD).
3. Implement until `pnpm --filter @<pkg> test` passes the BDD scenarios.
4. **PR description must list explicit BDD-line → test-name mapping** (every Given/When/Then has a corresponding `it(...)` in the test file). Codex flags coverage gaps; this pre-empts the flag.
5. Run `.claude/scripts/codex-review.sh <story-id>` before pushing — it loads the story BDD into the Codex prompt so the review checks semantic match, not just generic bugs.

## Anchor products + design tokens

- **Primary anchor:** Trigger.dev (`https://trigger.dev`) — execution-log/run-detail layout maps 1:1 to our proof-detail view; charcoal palette; Apache-2.0; Geist fonts (free).
- **Secondary anchor:** Hyperlane Explorer (`https://explorer.hyperlane.xyz`) — IA reference for on-chain attestation detail.
- **Anchor screenshots:** `screenshots/anchor/` — **immutable**, capture day-0 (post-Epic 5 kickoff) via `pnpm tsx scripts/capture-anchor.ts https://trigger.dev`.
- **Visual baselines:** `screenshots/baseline/` — update only via `--update-snapshots` on approved UI changes.
- **Palette (UX spec, locked):** bg `#15171A`, surface `#1A1B1F`, surface-elev `#22252D`, border `#363A45`, text-primary `#F5F5F5`, text-secondary `#A3A6B1`, accent verify `#10B981`, accent mock `#F59E0B`, accent unverified `#EF4444`, link `#3B82F6`. Dark-mode only.
- **Type:** Geist Sans 400/500/600/700, Geist Mono 400/500 for hashes/timestamps/addresses. Imported via `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700')`.
- **Spacing:** 4px base scale (4, 8, 12, 16, 24, 32, 48).
- **Route shape:** `/` (landing) + `/verify/[tokenId]` (proof chain) + `/api/verify/[tokenId]` (REST). Desktop-only (≥1024px) for hackathon scope.
- **Demo arc:** REVERSE — judge gets URL cold, verifies before context (ADR-11).

## Skills + plugins to invoke (Sahil's protocol)

| Trigger | Skill |
|---|---|
| Master coding protocol (every task) | `sahil-coding-protocol` |
| Behavioral guard against LLM coding mistakes | `andrej-karpathy-skills:karpathy-guidelines` |
| Starting any non-trivial task | `superpowers:writing-plans` |
| Implementing a feature | `superpowers:test-driven-development` (tests first, ATDD against story BDD) |
| Before claiming done | `superpowers:verification-before-completion` (run full local gate) |
| Before opening a PR | `superpowers:requesting-code-review` |
| Cross-lab review of own work | `sahil-pr-audit` (preferred) — fall back to `.claude/scripts/codex-review.sh <story-id>` |
| Codex review/rescue on a chunk | `codex:rescue` or `review-loop:review-loop` |
| Debugging a non-trivial bug | `superpowers:systematic-debugging` |
| 2+ independent tasks | `superpowers:dispatching-parallel-agents` |
| UI work BEFORE editing any frontend file | `sahil-ui-mining` (anchor first; capture into `screenshots/anchor/`) |
| Sourcing any new React component | `mcp__magic__21st_magic_component_inspiration` (cheap catalog probe) → adapt if hit, else `mcp__magic__21st_magic_component_builder`. Pair with `frontend-design`. Brand logos → `mcp__magic__logo_search`. **Non-negotiable.** |
| Vision audit BEFORE merging UI | `sahil-anti-slop-audit` |
| Commit + push + PR | `commit-commands:commit-push-pr` |
| Memory recall across sessions | `episodic-memory:remembering-conversations` |

If I'm tempted to skip these "just for this task" — that's the slop voice. Don't.

## Where things live

- **Memory (cross-session):** `~/.claude/projects/-Users-abu-dev-hackathon-OG-APAC/memory/` (`MEMORY.md` is the index)
- **Master entrypoint:** `context/CONTEXT.md`
- **Source-of-truth verdict:** `context/SOURCE_OF_TRUTH.md` (artifact-consistency audit, 4-test verification protocol)
- **Outwards audit:** `context/REFERENCE_REPO_AUDIT.md` (architectural-fit audit, 5 spec drifts caught + patched)
- **PRD + architecture:** `context/docs/PRD.md` (Etherscan-pitch + reverse demo arc), `context/docs/architecture.md` (12 ADRs, repo structure)
- **UX spec (canonical):** `context/docs/ux-spec.md`. `context/docs/DESIGN.md` is now a pointer at it.
- **Stories:** `context/docs/stories/story-<slug>.md` (14 of them, all audit-clean as of `0b3b7a9`)
- **Sprint status:** `context/docs/sprint-status.yaml` — update after each story merges
- **SDK refs:** `context/refs/sdk-snippets.md`
- **Cloned 0G refs:** `/tmp/og-refs/` — re-clone if missing (`.claude/scripts/clone-refs.sh` if added later)
- **Smoke tests:** `scripts/smoke/storage.ts` + `scripts/smoke/agenticid.ts` + `scripts/smoke/tee-headers.ts`
- **CI gate:** `.github/workflows/ci.yml`
- **Codex helpers:** `.claude/scripts/codex-review.sh` (pre-push) + `.claude/scripts/codex-watch.sh` (post-push)
- **Local env:** `.env` (gitignored — see `.env.example` for template). Includes funded testnet wallet `0x3b566583b51DA4da8d95565212C96836f66433A3`.
- **Anchor screenshots:** `screenshots/anchor/` (capture day-0 of Epic 5)
- **Visual baselines:** `screenshots/baseline/`

## CI requirement

`.github/workflows/ci.yml` must stay green on every commit. Pipeline:

1. `pnpm install --frozen-lockfile`
2. Reject placeholder `test` script + reject if no `*.test.ts` / `*.spec.ts` / `__tests__/` files exist
3. `pnpm exec tsc --noEmit` (strict, zero errors)
4. `pnpm run lint`
5. `pnpm test`
6. `pnpm run build`

Plus `chatgpt-codex-connector[bot]` and GitGuardian Security Checks run on every push.

If CI is red:
1. Stop current work.
2. Reproduce locally with the failing command.
3. Fix; re-run the full local gate.
4. Then continue.

**Never merge a PR while CI is red or Codex blockers are open.**

## Per-PR checklist

Before opening a PR:

- [ ] Tests written FIRST (ATDD against story BDD).
- [ ] Full local gate green (commands above; per-package `tsc --noEmit` for workspace packages once they exist).
- [ ] §14 grep clean on hot-path source files.
- [ ] `.claude/scripts/codex-review.sh <story-id>` run; valid findings addressed.
- [ ] PR body includes BDD-line → test-name mapping.
- [ ] PR title `feat(story-<slug>): …` / `fix: …` / `chore: …`.
- [ ] Branch named `epic/<n>-<slug>` (matches branch strategy).

After opening:

- [ ] Wait for `chatgpt-codex-connector[bot]` review (~5–10 min).
- [ ] Run `.claude/scripts/codex-watch.sh <pr-number>` to surface inline comments.
- [ ] Triage every comment per AGENTS.md (block / flag / approve).
- [ ] After fixes: follow-up commit; bot re-reviews on commit change.
- [ ] Merge after CI green AND bot 👍 (or remaining suggestions are non-blocking and replied to).
- [ ] Update `context/docs/sprint-status.yaml` for the merged story.

## Visual validation loop (enforced for UI work)

This project has a screenshot validation loop wired. It runs automatically. Do not skip it, do not disable it, do not change `screenshots/anchor/*` after day-0.

- `screenshots/anchor/` — captured day-0 from Trigger.dev. **Immutable.** Never overwrite.
- `screenshots/baseline/` — Playwright `toHaveScreenshot()` baselines. Update via `--update-snapshots` only on approved UI changes.
- `screenshots/current/` — last run output. Gitignored.
- `tests/visual/pages.spec.ts` — visual regression spec. Run with `pnpm exec playwright test`.
- `.claude/hooks/visual-check.sh` — fires on every Edit/Write that touches `app/**`, `components/**`, `*.tsx`. Writes verdict to `.claude/last-review.json`.
- After every UI edit, check `.claude/last-review.json` — fix `blocking` + `high` deltas before continuing.
- **Anchor is the floor.** If the build looks worse than the anchor at thumbnail, it's slop, regardless of what the slop_score says.
- **Multi-viewport.** Every component must look correct at desktop / mobile / tablet (mobile/tablet relaxed for hackathon scope).
