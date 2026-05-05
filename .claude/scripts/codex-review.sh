#!/usr/bin/env bash
# codex-review.sh — pre-push Codex review with story BDD acceptance bundled in.
#
# Why this exists: a generic "codex exec review" checks for bugs but not for
# SEMANTIC alignment with the story BDD acceptance criteria. This wrapper
# loads the story file (Given/When/Then + file map + shell verification)
# into the prompt so Codex evaluates the diff against the spec, not just
# against generic best practices.
#
# Usage:
#   .claude/scripts/codex-review.sh <story-id>
#
# Examples:
#   .claude/scripts/codex-review.sh storage-client
#   .claude/scripts/codex-review.sh tee-proof-flow
#
# Story files live at: context/docs/stories/story-<id>.md
#
# Exit codes:
#   0  Codex review completed (findings written to stdout)
#   2  Bad invocation (story file missing)
#   3  Codex CLI not installed or invocation failed

set -euo pipefail

STORY_ID="${1:-}"
if [ -z "$STORY_ID" ]; then
  echo "usage: codex-review.sh <story-id> (e.g. storage-client)" >&2
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

# Capture the diff vs main into /tmp/changes.patch.
git diff origin/main...HEAD > /tmp/changes.patch

# Build the prompt by assembling the static template + the story body.
# Use a temp file to avoid bash quoting issues with apostrophes in the
# template (heredocs inside $(...) parse awkwardly when prose contains
# single-quote characters).
PROMPT_FILE="$(mktemp -t codex-review-prompt.XXXXXX)"
trap 'rm -f "$PROMPT_FILE"' EXIT

{
  echo "You are reviewing a code diff against the BDD acceptance criteria of a"
  echo "specific story. The diff is at /tmp/changes.patch."
  echo ""
  echo "# STORY: ${STORY_ID}"
  echo ""
  cat "$STORY_FILE"
  echo ""
  echo "# REVIEW INSTRUCTIONS"
  echo ""
  echo "Read the diff at /tmp/changes.patch. Evaluate it against EACH acceptance"
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
  echo "  Tests       — meaningful coverage, every BDD line has a corresponding it()"
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
  echo "## Overall: Pass | Fail"
  echo "**Must-fix before merge:** items or none"
} > "$PROMPT_FILE"

echo "[codex-review] Reviewing story-${STORY_ID} against /tmp/changes.patch..."
echo "[codex-review] Story file: $STORY_FILE"
echo "[codex-review] Diff size: $(wc -l < /tmp/changes.patch) lines"
echo "[codex-review] Prompt size: $(wc -l < "$PROMPT_FILE") lines"
echo ""

codex exec review --base main --full-auto \
  --title "review story-${STORY_ID}" \
  "$(cat "$PROMPT_FILE")"
