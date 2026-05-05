#!/usr/bin/env bash
# Stop hook: block session exit while green-light is red — UNLESS the story deadline
# has elapsed, in which case allow exit so the orchestrator can move on. This is
# the consumer for the `.claude/.deadline` epoch-seconds sentinel written by
# story-start.sh (P0 finding 3 — hard 90-min session timeout).
# Output: {"decision":"block","reason":"..."} or {"decision":"allow"}
set -euo pipefail

# Deadline check first — if past the 90-min mark, force-allow exit no matter what
# green-light says. The orchestrator gets a clean stop signal instead of a zombie.
if [ -f ".claude/.deadline" ]; then
  DEADLINE=$(cat .claude/.deadline 2>/dev/null || echo 0)
  NOW=$(date -u +%s)
  if [ "$DEADLINE" -gt 0 ] && [ "$NOW" -ge "$DEADLINE" ]; then
    OVERSHOOT=$((NOW - DEADLINE))
    printf '{"decision":"allow","systemMessage":"deadline elapsed (+%ds) — force-stop, story-start expected exit by now"}\n' "$OVERSHOOT"
    # Also leave a breadcrumb for the orchestrator to surface
    echo "$(date -u -Iseconds) deadline_elapsed overshoot=${OVERSHOOT}s" >> .claude/.timeout-log 2>/dev/null || true
    exit 0
  fi
fi

if [ ! -f ".claude/scripts/green-light.sh" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

if output=$(.claude/scripts/green-light.sh 2>&1); then
  echo '{"decision":"allow"}'
else
  first=$(echo "$output" | grep -m1 '✗\|FAIL\|Error\|error' | head -c 200 || echo "unknown")
  printf '{"decision":"block","reason":"green-light failed: %s"}\n' "$first"
fi
