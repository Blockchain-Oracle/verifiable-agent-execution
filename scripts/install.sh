#!/usr/bin/env bash
#
# scripts/install.sh — one-shot installer for the Verifiable Execution
# OpenClaw plugin. Mirrors the xlmtools UX: ONE command, get a wallet
# + plugin ready to mint proofs.
#
# Usage:
#   ./scripts/install.sh
#
# What it does:
#   1. Checks Node.js 20+ + pnpm 9.15+ are installed
#   2. pnpm install (workspace deps)
#   3. Triggers the plugin's first-run banner — prints wallet
#      address + faucet URL
#   4. Prints next-steps (fund wallet, run dashboard, mint a proof)
#
# Idempotent: re-running is safe. Wallet is preserved across runs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Verifiable Execution — Installer"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: node not found. Install Node.js 20+ from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -e "console.log(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  ERROR: Node.js 20+ required (found $(node --version))." >&2
  exit 1
fi
echo "  ✓ Node.js $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "  ERROR: pnpm not found. Install: corepack enable" >&2
  exit 1
fi
echo "  ✓ pnpm $(pnpm --version)"
echo ""

echo "  Installing workspace dependencies..."
cd "$REPO_ROOT"
pnpm install --silent 2>&1 | tail -3
echo "  ✓ Dependencies installed"
echo ""

echo "  Initializing plugin wallet..."
echo ""
pnpm exec tsx scripts/init-wallet.ts || {
  echo "  Wallet init failed (see error above)." >&2
  exit 1
}

cat <<'EOF'
Next steps:
───────────────────────────────────────────────────────────────
  1. Fund your wallet:
       https://faucet.0g.ai → paste address above → claim 0.1 0G

  2. Run the dashboard (zero env vars needed):
       pnpm --filter @verifiable-agent-execution/dashboard dev

  3. Mint a demo proof against Galileo (~25-30s, uses funded wallet):
       set -a && source .env && set +a
       pnpm exec tsx scripts/smoke/defi-swap-demo.ts

  4. Open the proof in the dashboard:
       http://localhost:3000/verify/<tokenId-from-step-3>

  Or skip step 3 and view the pre-minted demo:
       http://localhost:3000/verify/98
───────────────────────────────────────────────────────────────

EOF
