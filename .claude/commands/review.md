Force a fresh-context cross-lab review pass with full BDD acceptance context.

## Usage

`/review <story-id>` — review the current diff against the story's BDD acceptance criteria + generic categories.

Example: `/review storage-client`

## Steps

1. Capture the diff:
   ```bash
   git diff origin/main...HEAD > /tmp/changes.patch
   ```

2. **Preferred path — Codex CLI with story-aware prompt:**
   ```bash
   .claude/scripts/codex-review.sh <story-id>
   ```
   This wrapper bundles `context/docs/stories/story-<id>.md` (BDD + file map + shell verification) into the Codex prompt so the review checks **semantic correctness against acceptance criteria**, not just generic best-practices.

3. **Fallback — Claude fresh-context reviewer:**
   If Codex CLI is unavailable, spawn the `code-reviewer` subagent from `.claude/agents/code-reviewer.md` in a fresh session. Pass the story id in the prompt; the agent reads the story file directly.

4. Save the verdict to `/tmp/review-output.md`.

5. If this is a GitHub PR:
   ```bash
   gh pr comment <PR_NUMBER> --body "$(cat /tmp/review-output.md)"
   ```

6. After post-push: surface bot findings with
   ```bash
   .claude/scripts/codex-watch.sh <PR_NUMBER>
   # or --watch to poll until reviewed
   ```

## Notes

- Do NOT use bare `codex review` (TUI; hangs in non-tty contexts).
- Use `codex exec review --base main --full-auto` if you need a custom prompt that the wrapper doesn't cover.
- Per CLAUDE.md "Codex Flow": never merge while CI red or Codex blockers open.
