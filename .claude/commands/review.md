Force a fresh-context cross-lab review pass.

## Steps
1. `cd <repo> && git diff origin/main...HEAD > /tmp/changes.patch`
2. Spawn Codex reviewer (if available):
   ```bash
   codex exec --search --xhigh \
     "Review /tmp/changes.patch. Categories: logic, security, performance, frontend, tests. \
      Binary Pass/Fail per category, file:line citations. Find at least one issue."
   ```
   Or spawn Claude fresh-context reviewer (if Codex unavailable):
   Run the `code-reviewer` subagent from `.claude/agents/code-reviewer.md` in a fresh session.
3. Save output to `/tmp/review-output.md`.
4. If this is a GitHub PR: `gh pr comment <PR_NUMBER> --body "$(cat /tmp/review-output.md)"`
