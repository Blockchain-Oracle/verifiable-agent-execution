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

# [verifiable-agent-execution] recent context, 2026-05-06 8:44am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (22,682t read) | 384,124t work | 94% savings

### May 6, 2026
73 7:17a ✅ Removed "Codex P?" placeholder from story-session-mint.md
74 7:19a 🟣 Added gated SessionAnchor live integration test to close on-chain confirmation gap
75 " 🔵 SessionAnchor gated integration test compiles and skips gracefully in CI
76 7:20a ✅ Committed round-4 fixes for codex R3 must-fix blockers
S15 Pre-push codex review cycle for PR #19: round-4b verdict monitoring after fixing round-3 findings (May 6 at 7:20 AM)
77 7:29a 🔵 Codex-review stdin blocking issue and workaround
78 7:31a 🟣 Gated SessionAnchor live integration test on Galileo testnet
79 " ✅ Removed "Codex P?" placeholder from story-session-mint documentation
80 " ⚖️ Pre-push local Codex review discipline for PR #19
81 " 🟣 SessionAnchor orchestrator implemented for on-chain session anchoring
82 " 🟣 AgenticIDClient implements ethers v6 wrapper over pre-deployed AgenticID contract
83 " ⚖️ Constructor requires explicit chainId instead of deriving from provider.getNetwork()
84 " 🔵 SessionAnchor unit tests use real SessionLogger with stubbed StorageClient
S16 Code review of session-mint story implementation (SessionAnchor orchestrator + AgenticIDClient wrapper) against BDD acceptance criteria (May 6 at 7:31 AM)
85 " 🔵 Round-4b Codex: documentation/test gating mismatch on live anchor verification
S17 Multi-round pre-push Codex review cycle for PR #19: resolve round-4 finding and await round-5 verdict before push (May 6 at 7:31 AM)
86 7:32a ✅ Fixed documentation/test gating mismatch in story-session-mint shell verification
87 " ✅ Committed round-4 Codex finding fix: story-session-mint env var documentation
S18 Review code diff against BDD acceptance criteria for session-mint story (SessionAnchor orchestrator for flushing session logs to 0G Storage and minting iNFTs on AgenticID) (May 6 at 7:33 AM)
S19 Multi-round pre-push Codex review cycle for PR #19 (rounds 4-6): iteratively fix findings and validate before push (May 6 at 7:35 AM)
88 7:35a ✅ Added type-level enforcement test for required 5-arg constructor (Codex R5)
89 7:36a ✅ Committed round-5 Codex finding: re-added type-level test for omitted options arg
S20 Monitor and check status of round-6 Codex review on PR #19 session-mint branch (May 6 at 7:37 AM)
90 7:40a 🔴 Chain integration tests fixed for SessionAnchor live-mint verification
S21 Observe and record codex pre-push code review rounds (3-6) for PR #19 in verifiable-agent-execution project; identify findings and fixes being applied (May 6 at 7:40 AM)
91 7:50a 🔵 Round-6 codex code review session confirmed active for PR #19
92 " 🔵 Codex review processing configuration files with no active child processes
93 " 🔵 Vitest does not support Jest's --runInBand flag
94 " 🔵 SessionAnchor test suite passes with 15/16 tests executed
95 " 🔴 SessionAnchor live integration test gap identified and fixed in round-3 codex review
96 " ✅ Documentation placeholder accidentally committed and removed
97 " 🔵 Round-6 codex review shows test execution failure in session-anchor.test.ts
98 7:51a 🔵 Event-confirmation validation gap identified in SessionAnchor implementation
99 " 🔵 SessionAnchor live integration tests passing with corrected test invocation
S22 Code review of session-mint story implementation (SessionAnchor) against BDD acceptance criteria from /tmp/changes.patch (May 6 at 7:51 AM)
S23 Implement Codex round-6 fix: validate IntelligentDataSet event data matches minted payload in AgenticID client (PR #19) (May 6 at 7:51 AM)
100 " 🔵 Round-6 codex review verdict: FAIL — event payload validation gap must be fixed before merge
101 " 🔵 Code inspection confirms parseTokenIdFromReceipt() lacks anchor data validation
102 " 🔵 mint() function calls parseTokenIdFromReceipt() with no data validation context
103 7:52a 🟣 Added AgenticIDMintEventDataMismatchError for event payload validation
104 8:22a 🔴 Added event data validation in AgenticID mint receipt parsing
105 8:25a 🟣 Implemented event data validation with detailed mismatch detection
106 " 🟣 Added comprehensive test coverage for event data mismatch validation
107 8:26a 🔵 AgenticIDMintEventDataMismatchError class definition is missing from errors.ts
108 8:28a 🔵 Tests now pass after adding error class imports; validation feature complete
109 8:29a 🟣 SessionAnchor orchestrator implements session flush → mint → anchor flow
110 " 🟣 AgenticIDClient wraps pre-deployed AgenticID contract with event-driven tokenId recovery
111 " ⚖️ 5-argument SessionAnchor constructor enforces explicit chainId (rejects 4-arg silent default pattern)
112 " 🟣 Comprehensive test coverage for SessionAnchor and AgenticIDClient with live integration gating
113 " ✅ Documentation updated with chainId spec evolution and live-test env var mapping
114 8:30a 🔵 Unit test suite passes: 40 passed, 3 skipped across AgenticIDClient and SessionAnchor
115 " 🔵 Code review verification: repository-specific requirements validated across diff
116 " 🔵 TypeScript compilation succeeds with no errors: tsc --noEmit passes
117 8:41a 🔵 PR #19 Round-7 Code Review: Documentation Test Count Stale, Must-Fix Identified
118 " ✅ Fixed Stale Test Count Documentation in story-session-mint.md
119 8:42a ✅ Committed Documentation Fix for Test Count on epic/03-onchain-anchor
120 8:43a 🟣 SessionAnchor and AgenticIDClient implementation with 5-arg constructor pattern
121 " ⚖️ Explicit chainId requirement in SessionAnchor constructor prevents silent network misconfiguration
122 " ✅ Documentation of integration test environment setup and conditional gating strategy
S24 Fix PR #19 must-fix blocker: update stale test count documentation in story-session-mint.md flagged by Codex R7 review (May 6 at 8:43 AM)
**Investigated**: Codex R7 review output identified that shell verification expected test count was stale. Round-6 added a 5th constructor arg type test (`options.chainId` required), bumping the session-anchor suite from 15 to 16 total tests, but documentation still claimed "15 passed (1 skipped / 0 skipped)." The actual behavior: without env vars = 16 total (15 passed | 1 skipped); with all four env vars = 16 passed | 0 skipped.

**Learned**: Round-6's biggest substantive finding was validating event data in AgenticIDClient.mint — without that check, the code would have returned tokenId for any IntelligentDataSet event, even with wrong data field (real on-chain correctness hole). Early review rounds (R3–R6) caught logic and security bugs; later rounds (R7–R8) focus on documentation accuracy. Codex runs documented shell commands to validate reported test counts.

**Completed**: Updated `context/docs/stories/story-session-mint.md` shell verification section to accurately reflect 16 total tests with conditional skip behavior. Committed fix to `epic/03-onchain-anchor` (commit 8239aff). Local validation confirmed: `pnpm test` runs 16 tests in session-anchor.test.ts; TypeScript compilation clean. All 7 BDD acceptance criteria pass; Logic, Security, Performance categories all pass; code quality gates (§14 grep, SDK names, ethers v6, evmVersion) all clean.

**Next Steps**: Round-8 Codex review running in background (task `bs92dhzi9`, monitoring `/tmp/pr19-r8-codex-review.log`). Watching for final verdict. If R8 returns another sub-100-character doc fix, apply and push; otherwise defer to web Codex as final arbiter before PR merge.


Access 384k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>