#!/usr/bin/env bash
# Single exit-0 gate for this repo. Run by stop-review.sh.
# Stack auto-detected. Package-manager aware and workspace-aware.
set -euo pipefail

PASS=true
fail() { echo "✗ $1"; PASS=false; }

detect_pm() {
  if [ -f "pnpm-lock.yaml" ] || [ -f "pnpm-workspace.yaml" ]; then
    echo pnpm
  elif [ -f "yarn.lock" ]; then
    echo yarn
  elif [ -f "package-lock.json" ] || [ -f "npm-shrinkwrap.json" ]; then
    echo npm
  elif command -v pnpm >/dev/null 2>&1; then
    echo pnpm
  elif command -v yarn >/dev/null 2>&1; then
    echo yarn
  else
    echo npm
  fi
}

PM="$(detect_pm)"

pm_has() {
  command -v "$1" >/dev/null 2>&1
}

pm_install() {
  case "$PM" in
    pnpm)
      if [ ! -d node_modules ]; then
        pnpm install --frozen-lockfile || pnpm install
      fi
      ;;
    yarn)
      if [ ! -d node_modules ] && [ ! -f .pnp.cjs ] && [ ! -f .pnp.js ]; then
        yarn install --immutable || yarn install --frozen-lockfile || yarn install
      fi
      ;;
    npm)
      if [ ! -d node_modules ]; then
        npm ci || npm install --no-fund --no-audit
      fi
      ;;
  esac
}

pm_exec() {
  dir="$1"
  shift
  case "$PM" in
    pnpm) pnpm --dir "$dir" exec "$@" ;;
    yarn)
      if yarn exec --help >/dev/null 2>&1; then
        yarn --cwd "$dir" exec "$@"
      else
        (cd "$dir" && yarn "$@")
      fi
      ;;
    npm) npm --prefix "$dir" exec -- "$@" ;;
  esac
}

pm_run() {
  dir="$1"
  script="$2"
  shift 2
  case "$PM" in
    pnpm) pnpm --dir "$dir" run "$script" "$@" ;;
    yarn) yarn --cwd "$dir" run "$script" "$@" ;;
    npm) npm --prefix "$dir" run "$script" --if-present "$@" ;;
  esac
}

script_exists() {
  pkg_dir="$1"
  script="$2"
  node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(p.scripts && p.scripts[process.argv[2]] ? 0 : 1)' "$pkg_dir/package.json" "$script"
}

has_real_tests() {
  pkg_dir="$1"
  find "$pkg_dir" -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path '*/.next' -prune -o \
    \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.js' -o -name '*.test.jsx' -o \
       -name '*.spec.ts' -o -name '*.spec.tsx' -o -name '*.spec.js' -o -name '*.spec.jsx' -o \
       -name '*.test.mts' -o -name '*.test.mjs' -o -name '*.spec.mts' -o -name '*.spec.mjs' -o \
       -path '*/__tests__/*' \) -print -quit | grep -q .
}

run_test_suite() {
  pkg_dir="$1"
  if [ ! -f "$pkg_dir/package.json" ] || ! script_exists "$pkg_dir" test; then
    return 0
  fi

  if ! has_real_tests "$pkg_dir"; then
    echo "↷ tests (skipped: no recognized test files in $pkg_dir)"
    return 0
  fi

  pm_run "$pkg_dir" test || fail "tests ($pkg_dir)"
}

run_lint_suite() {
  pkg_dir="$1"
  if [ ! -f "$pkg_dir/package.json" ] || ! script_exists "$pkg_dir" lint; then
    return 0
  fi
  pm_run "$pkg_dir" lint || fail "lint ($pkg_dir)"
}

run_build_suite() {
  pkg_dir="$1"
  if [ ! -f "$pkg_dir/package.json" ] || ! script_exists "$pkg_dir" build; then
    return 0
  fi
  pm_run "$pkg_dir" build || fail "build ($pkg_dir)"
}

run_types_for_tsconfigs() {
  while IFS= read -r tsconfig; do
    pkg_dir="$(dirname "$tsconfig")"
    case "$pkg_dir" in
      */node_modules/*|*/dist/*|*/.next/*) continue ;;
    esac
    echo "▶ types ($pkg_dir)"
    pm_exec "$pkg_dir" tsc -p "$(basename "$tsconfig")" --noEmit || fail "types ($pkg_dir)"
  done < <(find . -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path '*/.next' -prune -o -name 'tsconfig.json' -print)
}

pm_install

if [ -f "package.json" ] || [ -f "pnpm-workspace.yaml" ] || [ -f "yarn.lock" ] || [ -f "package-lock.json" ]; then
  echo "▶ tests"
  for pkg in contracts packages/cli packages/mcp packages/web; do
    [ -d "$pkg" ] || continue
    run_test_suite "$pkg"
  done

  echo "▶ lint"
  for pkg in contracts packages/cli packages/mcp packages/web; do
    [ -d "$pkg" ] || continue
    run_lint_suite "$pkg"
  done

  echo "▶ types"
  run_types_for_tsconfigs

  echo "▶ build"
  for pkg in contracts packages/cli packages/mcp packages/web; do
    [ -d "$pkg" ] || continue
    run_build_suite "$pkg"
  done
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  echo "▶ tests"
  python3 -m pytest -q || fail "tests"
  echo "▶ lint"
  python3 -m ruff check . || fail "lint"
  echo "▶ types"
  python3 -m mypy --strict || fail "types"
elif [ -f "Cargo.toml" ]; then
  echo "▶ tests"
  cargo test 2>&1 | tail -5 || fail "tests"
  echo "▶ lint"
  cargo clippy -- -D warnings 2>&1 | tail -5 || fail "lint"
  echo "▶ check"
  cargo check 2>&1 | tail -5 || fail "check"
elif [ -f "foundry.toml" ]; then
  echo "▶ tests"
  forge test 2>&1 | tail -10 || fail "tests"
  echo "▶ fmt"
  forge fmt --check || fail "fmt"
else
  echo "⚠ Unknown stack — no tests run"
fi

pm_has impeccable && { echo "▶ slop"; pm_exec . impeccable detect --strict || fail "slop"; }

# Playwright runs only for UI stories — gate on .claude/.story-type written by story-start.sh
# (Finding 1 — fixes the 3,021-retry case where a non-UI story tripped Playwright webServer)
if [ -f "playwright.config.ts" ]; then
  STORY_TYPE="$(cat .claude/.story-type 2>/dev/null || echo core)"
  if [ "$STORY_TYPE" = "ui" ]; then
    echo "▶ visual"
    pm_exec . playwright test --reporter=line || fail "visual"
  else
    echo "↷ visual (skipped: story-type=$STORY_TYPE — Playwright is UI-only)"
  fi
fi

[ "$PASS" = "true" ] && { echo "✅ green"; exit 0; } || { echo "❌ red"; exit 1; }
