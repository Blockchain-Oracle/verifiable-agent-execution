# AGENTS.md

This file is read by:
- **OpenAI Codex GitHub App** — for PR review guidance (see `## Review guidelines` below).
- **Codex CLI** when running `codex` interactively or via `codex exec` in this repo.
- Any other tool that follows the AGENTS.md convention.

The closest AGENTS.md to a changed file wins. Place tighter rules under
`packages/<x>/AGENTS.md` if a module needs them.

<!-- sahil-coding-protocol-review marker -->

## Review guidelines

These guidelines apply to Codex automatic PR reviews.

### Block on
- New behavior shipped without a corresponding test. Every story file in this
  repo has BDD acceptance criteria; the test must encode them before the
  implementation lands. **Every BDD `Then` line must have an `it(...)` test.**
- Swallowed errors (`catch (_) {}`, broad `except: pass`, `|| true` on commands
  whose failure matters). Errors must surface or be logged with reason.
- Mock data, placeholder strings, or fabricated values where real ones are
  expected — see the §14 anti-slop list in CLAUDE.md.
- Files added to bypass the green-light gate (skipping tests via `.skip`,
  disabling lint rules inline, `--no-verify` git pushes).
- Direct writes to `main` or other protected branches.
- Hardcoded secrets, API keys, or tokens.
- Hardcoded sponsor or stakeholder identifiers (channel IDs, chat IDs, repo
  slugs) inside operating logic — those belong in config or routing maps.
- **Project-specific (verifiable-agent-execution):**
  - Importing `@0gfoundation/0g-ts-sdk` (deprecated; use `@0gfoundation/0g-storage-ts-sdk`).
  - Importing `@0glabs/0g-serving-broker` (deprecated re-export shim; use `@0gfoundation/0g-compute-ts-sdk`).
  - `hardhat.config.ts` without `evmVersion: "cancun"` (ADR-09 — 0G Chain requires cancun for OZ `ECDSA.recover`).
  - OpenClaw plugin shipped with `SKILL.md` instead of `openclaw.plugin.json` (ADR-04 — `SKILL.md` is a Claude Code convention, not OpenClaw).
  - 0G storage SDK calls treated as throwing instead of returning `[result, err]` tuples (per `scripts/smoke/storage.ts`).
  - `MerkleTree.rootHash()` used as `string` without explicit `null` check (the SDK type is `string | null`).
  - ethers v5 patterns (`ethers.providers.JsonRpcProvider`, `ethers.utils.*`, `BigNumber.from`, `contract.deployed()`) — we use ethers ~6.13.1 only.
  - Any file in `packages/logger/src/`, `packages/tee-adapter/src/`, `packages/chain-client/src/`, `openclaw-skills/verifiable-execution/src/`, `apps/dashboard/src/lib/`, or `contracts/` that contains `mock|fake|dummy|hardcoded` (test fixtures under `__tests__/` and `__fixtures__/` exempt).

### Flag (don't auto-block)
- Three or more similar lines suggesting an abstraction may be premature.
- New dependencies for trivial functionality.
- Comments narrating what code does (the well-named identifier already does
  that). Comments are for the *why* — non-obvious constraints, workarounds,
  hidden invariants.
- Backwards-compatibility shims when the upstream caller can be updated in the
  same PR.

### Approve fast
- Tests that exercise BDD acceptance criteria from the story spec.
- Code that matches existing patterns in the same package.
- Diffs that delete more than they add (refactor or simplification).
- PRs that close a known mistakes-log entry under
  `obsidian-vault/Agent-Core/mistakes.md` upstream.

### Codex-specific
- If a PR comment mentions `@codex review`, run an additional review pass
  beyond the automatic one.
- If a PR comment mentions `@codex <free-text>`, treat as a Codex Cloud task
  request — do not interpret it as part of the review pass.

## Build & test

See `CLAUDE.md` for the full coding protocol. The local gate mirrors `.github/workflows/ci.yml`:

```bash
pnpm install --frozen-lockfile && \
pnpm exec tsc --noEmit && \
pnpm run lint && pnpm test && pnpm run build
```

Plus the §14 grep gate (see CLAUDE.md) for hot-path source files.

## Codex CLI invocation (canonical)

For pre-push reviews use the wrapper that bundles the story BDD into the prompt:

```bash
.claude/scripts/codex-review.sh <story-id>     # e.g. storage-client, tee-proof-flow
```

For post-push, surface the bot's findings (across reviews + inline comments + reactions):

```bash
.claude/scripts/codex-watch.sh <pr-number>     # one-shot
.claude/scripts/codex-watch.sh <pr-number> --watch   # poll every 30s until reviewed
```

Do NOT use bare `codex review` (TUI; hangs in non-tty contexts) — use `codex exec review --base main --full-auto` if a custom prompt is needed.


<claude-mem-context>
# Memory Context

# [verifiable-agent-execution] recent context, 2026-05-06 1:17pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,558t read) | 409,227t work | 95% savings

### May 6, 2026
S33 Validate end-to-end infrastructure and live token anchor; confirm Codex feedback on PR #20 and #21 has been addressed and shipped (May 6 at 10:55 AM)
S34 Respond to Codex feedback on PRs #20 and #21; validate infrastructure on live testnet; merge Epic 4; address R3 P1 finding on error handling (May 6 at 11:00 AM)
S35 Deploy MockTEEVerifier to testnet and create smoke tests to demonstrate end-to-end verified token minting with green badge (May 6 at 11:09 AM)
S36 Honest audit: goal vs delivery — compare the "Etherscan for AI agents" vision (PRD + UX spec) against what was actually built and shipped (May 6 at 11:17 AM)
S37 Honest architectural audit of Open Claw (Etherscan-for-AI-agents project): Does current implementation match the goal of making agent actions verifiable and traceable? (May 6 at 11:23 AM)
S38 First-principles decomposition of "Etherscan for AI agents" — identify and challenge assumptions in the current architecture to arrive at a rebuilt design that ships zero-config, tells a story (decoded content + proof), and enables sequential verification animation (May 6 at 11:31 AM)
S39 Implement zero-config UX for verifiable-agent-execution dashboard and plugin — eliminate env var requirements for demo/hackathon judges and agents (May 6 at 11:36 AM)
248 11:49a ✅ Updated .env.example: Zero-Config Deployment Documentation
249 11:51a ⚖️ Dashboard Zero-Config Refactor Complete; New Epic Opened for Plugin Auto-Wallet
250 " ✅ Dashboard Zero-Config Refactor Committed to epic/06-zero-config-ux
252 11:53a 🟣 Plugin Auto-Wallet Implementation: resolveWallet + printFirstRunBanner
253 11:54a 🔵 Current Plugin State: PRIVATE_KEY Env Required; Needs Integration with Auto-Wallet
256 11:55a 🟣 Plugin buildPluginState: Integrated Auto-Wallet Pattern (Zero-Config)
258 11:56a 🔵 Plugin index.ts: Duplicate Code After Auto-Wallet Integration (Syntax Error)
263 11:59a ✅ Plugin Auto-Wallet Implementation Committed to epic/06-zero-config-ux
S40 Continue verifiable-agent-execution hackathon project from previous session. Primary focus: complete Stages 6-7 (installation script and documentation) after Stages 1-5 were already implemented. Secondary focus: prepare submission-ready code and documentation for judges. (May 6 at 11:59 AM)
265 12:00p 🔵 ExecutionLogEntry Schema: Hashes Only, No Decoded Content Fields
S41 Build Etherscan-style dashboard for verifiable AI agent execution with live feed, agent profiles, and sequential verification animation (Stage 8 completion) (May 6 at 12:28 PM)
269 12:34p 🔵 Dashboard Structure Inventory for Zero-Config UX Work
270 12:35p ⚖️ Design System Selected: Dark Mode Web3 Aesthetic for Verifiable Agent Execution Dashboard
271 " 🔵 AgenticID Smart Contract Integration Target Identified
272 12:36p 🔵 AgenticID Live Execution Logs Retrieved from ZG Testnet
273 12:37p 🟣 Feed Data Layer Implemented: AgenticID Contract Integration
274 " 🟣 API Endpoint Created: /api/feed for Live Feed Data
275 12:38p 🟣 Agent History API Endpoint: /api/agent/[address] Implemented
276 12:39p 🟣 TopBar Navigation Component Implemented
277 " 🟣 SearchBar Component with Intelligent Routing
278 12:40p 🟣 FeedTable Component: Live Agent Sessions Explorer
279 " 🟣 Mono Component: Design Primitive for Cryptographic Data Display
280 12:41p 🟣 Agent Detail Page Implemented: /agent/[address] Route
281 12:42p 🔵 TypeScript Type Errors Detected in Agent Page
282 12:43p 🔴 Fixed TypeScript Type Errors in Agent Page
283 12:44p 🟣 EntryCard Component: Individual Tool Call Verification Display
284 12:45p 🟣 SessionView Component: Proof Chain Verification Orchestrator
287 12:47p ✅ Landing Page Redesigned: Full Editorial Marketing Page
288 12:48p ✅ Verify Page Refactored: Integrated SessionView Interactive Component
290 12:49p 🟣 Stage 8 Shipped: Etherscan-Grade Dashboard Complete
291 " ✅ Stage 8 Pushed to GitHub: epic/06-zero-config-ux Branch Updated
292 12:52p 🔵 Design Pattern Research: Component Inspiration from Magic MCP
293 12:53p 🟣 RootHashWatermark Component: Cryptographic Proof as Visual Anchor
294 " 🟣 VerificationTicker Component: Real-Time Verification Narrative
295 12:54p ✅ CSS Utilities Added: Ticker Animation, Token Stamp, Perforated Border
296 12:56p ✅ SessionView Refactored: Four Bold Moves of Proof-Detail Page
297 12:57p ✅ RootHashWatermark Integrated into Verify Page Layout
298 12:58p 🔵 Build Failure: API Route Page Data Collection Error
S42 Stage 9 polish completion — implement four bold design moves via SCAMPER methodology and Magic MCP patterns to elevate dashboard from functional to memorable (May 6 at 1:01 PM)
303 1:15p 🟣 Verifier UI Components Implemented for Proof-Chain Rendering
304 " ✅ Demo Script and Repositioned Pitch to "Etherscan for AI Agents"
305 " 🟣 LogEntry and StatusBadge Components Render Execution Log Details and Verification Status
306 " 🟣 Verify Page and Proof Error Handling with Cold-Open UX
307 " 🟣 ProofChainSkeleton Loading State with 4+ Placeholder Cards
308 " 🔴 Test File Missing: verifier-ui.test.tsx Not Found
309 " 🟣 ProofFetchError and fetchProof Client Wrapper for Proof API
310 1:16p 🟣 SessionView Auto-Verification with Sequential Badge-Flip Animation
311 " 🟣 EntryCard Renders Decoded Tool Params/Result with State-Driven Badge
312 " 🟣 Server-Side Proof Resolution: AgenticID → 0G Storage → TEEVerifier
313 " ⚖️ Zero-Setup Environment: All Contract Addresses Hardcoded, Optional Env Var Overrides
314 " 🔴 Test File Missing: verifier-ui.test.tsx Does Not Exist
315 1:17p 🟣 API Route for Per-Entry Verification and Proof Resolution
316 " ✅ Verifier UI Story Verdict: Build Succeeds, Test File Missing

Access 409k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>