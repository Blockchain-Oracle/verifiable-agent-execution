---
name: visual-review
description: Run an ad-hoc visual review against the anchor. Captures fresh screenshot, diffs vs anchor, runs reviewer, prints verdict.
---

Run a one-off visual review on the current state of the app. Use when:
- You just made a UI change and want a quick verdict before continuing
- The PostToolUse hook is disabled or skipped
- You want to inspect a specific viewport (`/visual-review mobile`)

## What this does

1. Triggers `playwright test tests/visual/pages.spec.ts` to refresh `screenshots/current/`
2. Runs `.claude/hooks/visual_reviewer.py` against the home page at desktop viewport
3. Prints the structured JSON verdict
4. If `verdict !== "ok"`, lists every blocking + high delta with fix actions

## Usage

```
/visual-review              # default: home, desktop
/visual-review mobile       # home, mobile viewport
/visual-review /dashboard   # specific route, desktop
```

## Implementation

Run this bash script:

```bash
ROUTE="${1:-/}"
VIEWPORT="${2:-desktop}"
SLUG="$(echo "$ROUTE" | sed 's|/|_|g; s|^_||; s|^$|home|')"

bash .claude/hooks/visual-check.sh --final
echo
echo "Result above. Anchor: screenshots/anchor/${SLUG}--${VIEWPORT}.png"
echo "Current: screenshots/current/${SLUG}--${VIEWPORT}.png"
```

If `verdict === "ok"`: green-light to merge.
If `verdict === "needs-fix"`: address every blocking + high delta, re-run.
If `verdict === "slop"`: do not merge. Likely missing DESIGN.md or palette tokens. Go back to anchor.
