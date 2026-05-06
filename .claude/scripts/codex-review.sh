#!/usr/bin/env bash
# codex-review.sh — pre-push Codex review with story BDD acceptance bundled in.
#
# Why this exists: a generic `codex exec review --base main` checks for
# bugs but is BLIND to the story's BDD acceptance criteria. This wrapper
# loads the story file (Given/When/Then + file map + shell verification)
# into the prompt so Codex evaluates the diff against the spec, not just
# against generic best practices.
#
# CLI compatibility note (Codex CLI v0.125+): `codex exec review` made
# `--base <BRANCH>` and `[PROMPT]` mutually exclusive, so we use the
# more flexible `codex exec` subcommand instead. We pre-write the diff
# vs main to /tmp/changes.patch and tell Codex to read it.
#
# Usage:
#   .claude/scripts/codex-review.sh <story-id>
#   .claude/scripts/codex-review.sh <story-id> --base <branch>   # diff vs <branch> instead of main
#
# Examples:
#   .claude/scripts/codex-review.sh storage-client
#   .claude/scripts/codex-review.sh tee-proof-flow --base epic/01-logger-core
#
# Story files live at: context/docs/stories/story-<id>.md
#
# Exit codes:
#   0  Codex review completed (verdict written to stdout)
#   2  Bad invocation (story file missing)
#   3  Codex CLI not installed or invocation failed

set -euo pipefail

STORY_ID="${1:-}"
BASE_BRANCH="${3:-origin/main}"
if [ "${2:-}" = "--base" ] && [ -n "${3:-}" ]; then
  BASE_BRANCH="$3"
fi

if [ -z "$STORY_ID" ]; then
  echo "usage: codex-review.sh <story-id> [--base <branch>]" >&2
  echo "       e.g. codex-review.sh storage-client" >&2
  exit 2
fi
STORY_FILE="context/docs/stories/story-${STORY_ID}.md"

if [ ! -f "$STORY_FILE" ]; then
  echo "ERROR: story file not found: $STORY_FILE" >&2
  echo "Available stories:" >&2
  ls context/docs/stories/story-*.md 2>/dev/null | sed 's|.*story-|  |;s|\.md$||' >&2
  exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found. Install per Codex docs." >&2
  exit 3
fi

# Capture the diff vs the chosen base into /tmp/changes.patch so the
# prompt can reference it without echoing into shell args.
git diff "${BASE_BRANCH}...HEAD" > /tmp/changes.patch
DIFF_LINES="$(wc -l < /tmp/changes.patch | tr -d ' ')"

# Build the prompt. Using `cat` heredocs without command substitution
# avoids the apostrophe-in-prose parsing issue that bit the first
# version of this script.
PROMPT_FILE="$(mktemp -t codex-review-prompt.XXXXXX)"
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  echo "You are reviewing a code diff against the BDD acceptance criteria of"
  echo "a specific story. The diff is at /tmp/changes.patch (also reachable"
  echo "via \`git diff ${BASE_BRANCH}...HEAD\`)."
  echo ""
  echo "# STORY: ${STORY_ID}"
  echo ""
  cat "$STORY_FILE"
  echo ""
  echo "# REVIEW INSTRUCTIONS"
  echo ""
  echo "Read /tmp/changes.patch. Evaluate it against EACH acceptance"
  echo "criterion above. For each criterion, decide:"
  echo "  - PASS  — the diff faithfully implements this Given/When/Then"
  echo "  - FAIL  — the diff is missing implementation OR violates the criterion"
  echo "  - PART  — partial; cite what is covered and what is not"
  echo ""
  echo "Then run the standard categories:"
  echo "  Logic       — does it do what the spec says (beyond the BDD)?"
  echo "  Security    — injection, auth bypass, OWASP, exposed secrets, hardcoded keys"
  echo "  Performance — N+1, blocking ops, memory leaks"
  echo "  Frontend    — slop tells, anchor divergence, a11y (skip if no UI change)"
  echo "  Tests       — meaningful coverage; every BDD line has a corresponding it()"
  echo ""
  echo "Repo-specific things to ALWAYS check (per CLAUDE.md anti-slop list):"
  echo "  - No mock|fake|dummy|hardcoded in hot-path src (Mock*.sol exempt)"
  echo "  - 0G storage SDK uses [result, err] tuples, not throws"
  echo "  - MerkleTree.rootHash() is string|null — null must be handled"
  echo "  - hardhat.config.ts must keep evmVersion: \"cancun\" (ADR-09)"
  echo "  - OpenClaw plugin format is openclaw.plugin.json, not SKILL.md"
  echo "  - Imports use @0gfoundation/0g-storage-ts-sdk and"
  echo "    @0gfoundation/0g-compute-ts-sdk (NOT the deprecated names)"
  echo "  - ethers v6 syntax only (no ethers.providers.*, ethers.utils.*,"
  echo "    BigNumber.from, contract.deployed())"
  echo "  - Doc/code drift: every path in CLAUDE.md / READMEs / PR body"
  echo "    must resolve on the branch"
  echo ""
  echo "# RULES"
  echo "- Find at least one substantive issue. \"Looks good\" is not valid output."
  echo "- Cite file:line for every finding."
  echo "- If a security issue is found, flag it FIRST regardless of order."
  echo "- Use the verdict format below — keep it parseable."
  echo ""
  echo "# OUTPUT FORMAT"
  echo ""
  echo "## Acceptance criteria check (per BDD line)"
  echo "- [PASS|FAIL|PART] one-line summary of which criterion"
  echo "  - file:line — what is wrong (if FAIL/PART)"
  echo ""
  echo "## Categories"
  echo "**Logic:** Pass | Fail"
  echo "- file:line — finding"
  echo ""
  echo "**Security:** Pass | Fail"
  echo "- file:line — finding"
  echo ""
  echo "**Performance:** Pass | Fail"
  echo "- file:line — finding"
  echo ""
  echo "**Frontend:** Pass | Fail | n/a"
  echo "- file:line — finding"
  echo ""
  echo "**Tests:** Pass | Fail"
  echo "- file:line — finding"
  echo ""
  echo "## Repo-specific checks"
  echo "- §14 grep gate, doc/code drift, package names, ethers v6, etc."
  echo ""
  echo "## Overall: Pass | Fail"
  echo "**Must-fix before merge:** items or none"
} > "$PROMPT_FILE"

echo "[codex-review] Reviewing story-${STORY_ID} against /tmp/changes.patch..."
echo "[codex-review] Story file:   $STORY_FILE"
echo "[codex-review] Base branch:  $BASE_BRANCH"
echo "[codex-review] Diff size:    $DIFF_LINES lines"
echo "[codex-review] Prompt size:  $(wc -l < "$PROMPT_FILE" | tr -d ' ') lines"
echo ""

# Use `codex exec` (not `codex exec review --base`) — the former accepts
# arbitrary [PROMPT] without conflicting with diff-source flags. We
# already captured the diff to /tmp/changes.patch above; the prompt
# instructs Codex to read it.
codex exec --full-auto "$(cat "$PROMPT_FILE")"
