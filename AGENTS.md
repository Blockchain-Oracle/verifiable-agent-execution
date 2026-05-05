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
