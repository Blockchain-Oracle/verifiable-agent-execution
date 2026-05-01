#!/usr/bin/env bash
# .claude/hooks/visual-check.sh — PostToolUse + Stop hook entrypoint
# Exits 0 (PostToolUse: advisory only, never hard-blocks edits).
# At Stop (--final) it emits a Stop-hook JSON decision: blocks termination if visual gate failed.
# Job: capture current screenshot, diff vs baseline, run reviewer, write verdict.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

FINAL=0
[[ "${1:-}" == "--final" ]] && FINAL=1

CURRENT_DIR="screenshots/current"
ANCHOR_DIR="screenshots/anchor"
BASELINE_DIR="screenshots/baseline"
OUT_FILE=".claude/last-review.json"
LOG=".claude/visual-check.log"

mkdir -p "$CURRENT_DIR" .claude
echo "[$(date -Iseconds)] visual-check start (final=$FINAL)" >> "$LOG"

# 1. App must be reachable. If not, write a soft verdict and exit 0.
if ! curl -fsS -o /dev/null --max-time 3 http://localhost:3000; then
  echo '{"verdict":"skipped","reason":"dev server not reachable on :3000"}' > "$OUT_FILE"
  echo "[$(date -Iseconds)] dev server down — skipping" >> "$LOG"
  exit 0
fi

# 2. Run the Playwright spec to refresh current screenshots.
if ! pnpm exec playwright test tests/visual/pages.spec.ts --update-snapshots=none >> "$LOG" 2>&1; then
  echo "[$(date -Iseconds)] playwright run failed — continuing with whatever exists" >> "$LOG"
fi

# 3. Pick a representative current/anchor pair (home page, desktop) for the reviewer.
CURRENT="$(ls -1 "$CURRENT_DIR"/home--desktop*.png 2>/dev/null | head -n1)"
ANCHOR="$(ls -1 "$ANCHOR_DIR"/home--desktop*.png 2>/dev/null | head -n1)"

if [[ -z "$CURRENT" || -z "$ANCHOR" ]]; then
  echo '{"verdict":"skipped","reason":"missing anchor or current screenshot"}' > "$OUT_FILE"
  echo "[$(date -Iseconds)] anchor/current missing — skipping reviewer" >> "$LOG"
  exit 0
fi

# 4. Run the SDK-based reviewer. It writes JSON to OUT_FILE.
python3 .claude/hooks/visual_reviewer.py \
  --anchor "$ANCHOR" \
  --current "$CURRENT" \
  --out "$OUT_FILE" >> "$LOG" 2>&1 || true

# 5. On --final (Stop hook): emit Stop-hook JSON decision. BLOCKS exit if visual gate failed.
if [[ "$FINAL" == "1" && -f "$OUT_FILE" ]]; then
  echo "Visual review verdict:"
  cat "$OUT_FILE"

  VERDICT=$(python3 -c "import json; d=json.load(open('$OUT_FILE')); print(d.get('verdict','unknown'))" 2>/dev/null || echo unknown)
  SLOP=$(python3 -c "import json; d=json.load(open('$OUT_FILE')); print(d.get('slop_score', 99))" 2>/dev/null || echo 99)
  BLOCKING=$(python3 -c "import json; d=json.load(open('$OUT_FILE')); print(d.get('blocking_count', 99))" 2>/dev/null || echo 99)

  case "$VERDICT" in
    skipped|unknown)
      echo '{"decision":"allow"}'
      ;;
    ok)
      if [ "$SLOP" -le 2 ] && [ "$BLOCKING" = "0" ]; then
        echo '{"decision":"allow"}'
      else
        printf '{"decision":"block","reason":"visual gate failed: slop=%s blocking=%s — fix UI before stopping"}\n' "$SLOP" "$BLOCKING"
      fi
      ;;
    *)
      printf '{"decision":"block","reason":"visual verdict=%s — fix UI before stopping"}\n' "$VERDICT"
      ;;
  esac
fi

exit 0
