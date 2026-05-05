#!/usr/bin/env bash
# codex-watch.sh — surface every Codex review signal on a PR.
#
# Why this exists: `gh pr view` only shows the *headline* review body
# ("Here are some automated review suggestions"). The actual P1/P2/P3
# findings are inline comments on a different API endpoint, and Codex
# also signals state via emoji reactions on the PR. Three endpoints
# must be polled to know the full state:
#
#   1. /pulls/<n>/reviews          — headline review submissions (state)
#   2. /pulls/<n>/comments         — inline per-line P1/P2/P3 (the meat)
#   3. /issues/<n>/reactions       — eyes=reviewing, +1=approved
#
# Codex bot login: chatgpt-codex-connector[bot]
#
# Usage: .claude/scripts/codex-watch.sh <pr-number> [--watch]
#   --watch  poll every 30s until Codex has reviewed the head SHA and
#            either reacted +1 or its findings are printed.
#
# Exit codes:
#   0  Codex has reviewed head SHA and approved (👍 reaction)
#   1  Codex has reviewed head SHA and left findings (printed above)
#   2  Codex has not yet reviewed head SHA (still pending)
#   3  Bad invocation / API error

set -euo pipefail

PR="${1:?usage: codex-watch.sh <pr-number> [--watch]}"
WATCH="${2:-}"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
BOT="chatgpt-codex-connector[bot]"

# Fetch a paginated list endpoint and emit a single JSON array.
fetch_paginated_array() {
  local path="$1"
  local out rc
  set +e
  out="$(gh api --paginate "$path" 2>&1)"
  rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "ERROR: GitHub API call failed for $path (exit $rc):" >&2
    echo "$out" >&2
    return 3
  fi
  printf '%s' "$out" | jq -s 'add // []'
}

check_once() {
  local head_sha
  head_sha="$(gh api "repos/$REPO/pulls/$PR" --jq .head.sha)"

  # Use earliest check_suite.created_at for the head SHA as the "push time"
  # proxy. commit.committer.date is wrong for cherry-picks/rebases.
  local suites_out suites_rc
  set +e
  suites_out="$(gh api --paginate "repos/$REPO/commits/$head_sha/check-suites" 2>&1)"
  suites_rc=$?
  set -e

  local pushed_at=""
  if [ $suites_rc -eq 0 ]; then
    pushed_at="$(printf '%s' "$suites_out" | jq -rs '
      [.[].check_suites // [] | .[].created_at] | min // empty
    ')"
  fi
  if [ -z "$pushed_at" ]; then
    # Fallback: commit committer date (less reliable, but works on
    # repos with no workflows configured).
    pushed_at="$(gh api "repos/$REPO/commits/$head_sha" --jq .commit.committer.date)"
  fi

  echo "Head SHA: $head_sha (pushed ~$pushed_at)"

  # 1. Headline reviews
  local reviews
  reviews="$(fetch_paginated_array "repos/$REPO/pulls/$PR/reviews")"
  local headline
  headline="$(printf '%s' "$reviews" | jq --arg bot "$BOT" --arg sha "$head_sha" '
    [.[] | select(.user.login == $bot and .commit_id == $sha)] | last
  ')"
  if [ "$headline" = "null" ] || [ -z "$headline" ]; then
    echo ""
    echo "  ⏳ No Codex headline review for head SHA yet — still pending."
    return 2
  fi

  echo ""
  echo "=== Codex headline review (state: $(echo "$headline" | jq -r .state)) ==="
  printf '%s\n' "$(echo "$headline" | jq -r .body)" | head -40

  # 2. Per-line inline comments
  echo ""
  echo "=== Codex inline findings (per-line comments on head SHA) ==="
  local comments
  comments="$(fetch_paginated_array "repos/$REPO/pulls/$PR/comments")"
  local count
  count="$(printf '%s' "$comments" | jq --arg bot "$BOT" --arg sha "$head_sha" '
    [.[] | select(.user.login == $bot and .commit_id == $sha)] | length
  ')"
  if [ "$count" -eq 0 ]; then
    echo "  (none for head SHA)"
  else
    printf '%s' "$comments" | jq -r --arg bot "$BOT" --arg sha "$head_sha" '
      .[]
      | select(.user.login == $bot and .commit_id == $sha)
      | "[\(.path):\(.line // .original_line // "?")] \(.body | split("\n")[0:3] | join(" "))"
    '
  fi

  # 3. Reactions on the PR (eyes / +1)
  echo ""
  echo "=== Codex reactions on the PR ==="
  local reactions
  reactions="$(fetch_paginated_array "repos/$REPO/issues/$PR/reactions")"
  printf '%s' "$reactions" | jq -r --arg bot "$BOT" '
    [.[] | select(.user.login == $bot)]
    | map("\(.content) (at \(.created_at))")
    | if length == 0 then "  (none from \($bot))" else .[] end
  '

  # Final verdict
  local approved
  approved="$(printf '%s' "$reactions" | jq --arg bot "$BOT" '
    [.[] | select(.user.login == $bot and .content == "+1")] | length > 0
  ')"
  if [ "$approved" = "true" ] && [ "$count" -eq 0 ]; then
    echo ""
    echo "✅ Codex approved head SHA with no inline findings."
    return 0
  else
    echo ""
    echo "⚠️  Codex has findings on head SHA — review and address before merge."
    return 1
  fi
}

if [ "$WATCH" = "--watch" ]; then
  while true; do
    set +e
    check_once
    rc=$?
    set -e
    if [ $rc -ne 2 ]; then
      exit $rc
    fi
    echo ""
    echo "Polling again in 30s... (Ctrl-C to stop)"
    sleep 30
  done
else
  check_once
fi
