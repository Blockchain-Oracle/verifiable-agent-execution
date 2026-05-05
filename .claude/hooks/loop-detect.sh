#!/usr/bin/env bash
# PostToolUse hook: claudewatch-style 3-error trip.
# Always exits 0 — warns but never blocks tool use.
set -euo pipefail

STATE=".claude/.loop-state"
CURRENT="${CLAUDE_TOOL_RESULT:-}"

if [ -z "$CURRENT" ]; then exit 0; fi

normalize() {
  printf '%s' "$1" \
    | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g' \
    | tr '\n' ' ' \
    | tr -s '[:space:]' ' ' \
    | sed 's/^ *//; s/ *$//'
}

SIG="$(normalize "$CURRENT")"
if [ -z "$SIG" ]; then exit 0; fi

if command -v sha256sum >/dev/null 2>&1; then
  CURRENT="$(printf '%s' "$SIG" | sha256sum | awk '{print $1}')"
else
  CURRENT="$SIG"
fi

LAST=""
COUNT=0

if [ -f "$STATE" ]; then
  LAST=$(sed -n '1p' "$STATE" 2>/dev/null || true)
  COUNT=$(sed -n '2p' "$STATE" 2>/dev/null || echo 0)
fi

if [ "$CURRENT" = "$LAST" ]; then
  COUNT=$((COUNT + 1))
else
  COUNT=1
fi

printf '%s\n%d\n' "$CURRENT" "$COUNT" > "$STATE"

if [ "$COUNT" -ge 3 ]; then
  # Emit Stop/PostToolBatch hook block JSON (per Claude Code hooks contract)
  printf '{"decision":"block","reason":"Loop detected: same tool result %dx in a row. Stop, write what you know vs assume, switch approach or escalate."}\n' "$COUNT"
  exit 0
fi

exit 0
