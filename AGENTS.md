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
  implementation lands.
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

See `CLAUDE.md` for the full coding protocol. The single gate is
`.claude/scripts/green-light.sh` — when it exits 0, the change is ready.
