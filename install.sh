#!/usr/bin/env bash
#
# install.sh — verifiable-agent-execution OpenClaw plugin installer.
#
# Mirrors the 0g-memory pattern: link the plugin into the OpenClaw CLI
# via `openclaw plugins install --link`, enable it, and seed
# ~/.openclaw/openclaw.json with sensible Galileo testnet defaults.
# Then prints a 3-line "what to do next" footer.
#
# Idempotent — safe to re-run. Existing config blocks are not clobbered.
#
# Requirements:
#   - openclaw binary on PATH (https://openclaw.ai)
#   - node 20+ + pnpm 9+ (only needed to install the plugin's deps;
#     the plugin itself is TS, loaded by OpenClaw's jiti runtime).
#   - jq (used to patch ~/.openclaw/openclaw.json safely)
#
# Usage:
#   git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
#   cd verifiable-agent-execution
#   ./install.sh
#   openclaw gateway restart

set -euo pipefail

# ── Defaults — Galileo testnet (Epic-7 OUR deploys per ADR-13) ───────────────
# Override any of these via env BEFORE running ./install.sh, e.g.:
#   CHAIN_ID=16661 RPC_URL=https://evmrpc.0g.ai ./install.sh   # mainnet
#
# Required-config keys come from openclaw-skills/verifiable-execution/openclaw.plugin.json
DEFAULT_RPC_URL="${RPC_URL:-https://evmrpc-testnet.0g.ai}"
DEFAULT_INDEXER_URL="${INDEXER_URL:-https://indexer-storage-testnet-turbo.0g.ai}"
DEFAULT_AGENTICID="${AGENTICID_ADDRESS:-0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38}"
DEFAULT_VERIFIER="${TEE_VERIFIER_ADDRESS:-0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad}"
DEFAULT_VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://verifiable.0g.ai}"
DEFAULT_CHAIN_ID="${CHAIN_ID:-16602}"
DEFAULT_MODEL_ID="${MODEL_ID:-claude-sonnet-4-6}"

PLUGIN_ID="verifiable-execution"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/openclaw-skills/$PLUGIN_ID"
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"

# ── Pretty output helpers ────────────────────────────────────────────────────
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '  \033[34mℹ\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── Sanity checks ────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " verifiable-agent-execution — OpenClaw plugin installer"
echo "════════════════════════════════════════════════════════════════"
echo

[ -d "$PLUGIN_DIR" ] || fail "Plugin source not found at $PLUGIN_DIR"
[ -f "$PLUGIN_DIR/openclaw.plugin.json" ] || fail "Missing $PLUGIN_DIR/openclaw.plugin.json"

command -v openclaw >/dev/null 2>&1 \
  || fail "'openclaw' CLI not found in PATH. Install it from https://openclaw.ai"
command -v jq >/dev/null 2>&1 \
  || fail "'jq' not found. Install it with 'brew install jq' (mac) or 'apt-get install jq' (ubuntu)."

# We pin to pnpm@9.15.4 (matches root package.json `packageManager`). If
# pnpm isn't on PATH we shell out via `npx -y pnpm@9.15.4` — npx ships
# with every Node install, so the only hard requirement is Node 20+.
# This removes the "I only have npm" friction without committing us to
# maintaining a second lockfile (npm and pnpm produce different
# workspace symlink layouts; one source-of-truth is safer).
if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
  PKG_MGR_LABEL="pnpm $(pnpm --version) (system)"
else
  command -v npx >/dev/null 2>&1 \
    || fail "'npx' not found — install Node.js 20+ from https://nodejs.org (npx ships with it)."
  PNPM_CMD=(npx -y pnpm@9.15.4)
  PKG_MGR_LABEL="pnpm@9.15.4 via npx (system pnpm not found)"
fi

ok "openclaw $(openclaw --version 2>/dev/null | head -1 || echo '?')"
ok "$PKG_MGR_LABEL"
ok "jq $(jq --version)"
ok "plugin source: $PLUGIN_DIR"

# ── Step 0: install workspace deps so OpenClaw's jiti loader can resolve them
# Our plugin imports `@verifiable-agent-execution/chain-client` (workspace:*)
# and `ethers` — both need to be on disk before OpenClaw can load us. Unlike
# evermemos (zero runtime deps), we have a chain client to bring along.
echo
info "Step 0/3 — installing workspace dependencies"
( cd "$SCRIPT_DIR" && "${PNPM_CMD[@]}" install --frozen-lockfile 2>&1 | tail -5 | sed 's/^/    /' )
ok "deps installed"

# ── Step 1: link the plugin via OpenClaw CLI ─────────────────────────────────
#
# `--dangerously-force-unsafe-install` is required because pnpm workspaces
# put third-party deps in a shared `.pnpm/` store and symlink to them from
# the plugin's `node_modules/`. OpenClaw's security scanner flags these
# "symlink target outside install root" as a potential local-dev attack
# vector — for our plugin it's just the normal pnpm workspace layout.
# When we publish to npm (TODO post-hackathon) the tarball is flat and
# this flag goes away. The plugin source is open & reviewable either way.
echo
info "Step 1/3 — linking plugin into OpenClaw"
if openclaw plugins install --link "$PLUGIN_DIR" --dangerously-force-unsafe-install 2>&1 | sed 's/^/    /'; then
  ok "linked $PLUGIN_ID"
else
  fail "'openclaw plugins install --link' failed — see output above"
fi

# ── Step 2: enable the plugin ────────────────────────────────────────────────
echo
info "Step 2/3 — enabling plugin"
if openclaw plugins enable "$PLUGIN_ID" 2>&1 | sed 's/^/    /'; then
  ok "enabled $PLUGIN_ID"
else
  # Non-fatal — may already be enabled from a previous run.
  warn "'openclaw plugins enable' exited non-zero (probably already enabled)"
fi

# ── Step 3: seed ~/.openclaw/openclaw.json config block ──────────────────────
echo
info "Step 3/3 — seeding ~/.openclaw/openclaw.json with network defaults"

mkdir -p "$(dirname "$OPENCLAW_CONFIG")"
[ -f "$OPENCLAW_CONFIG" ] || echo '{}' > "$OPENCLAW_CONFIG"

# Backup once per day so a botched re-run is recoverable.
BACKUP="$OPENCLAW_CONFIG.bak.$(date +%Y%m%d)"
[ -f "$BACKUP" ] || cp "$OPENCLAW_CONFIG" "$BACKUP"

# Build the plugin config block. We thread agentId in as a placeholder
# string the user must replace; the plugin enters degraded (no-op) mode
# until it's a real 0x-prefixed address — that's a deliberate guard
# against silent mis-tagged proofs.
AGENT_ID_PLACEHOLDER="0x0000000000000000000000000000000000000000"

# jq does the JSON edit atomically (read → modify → write to temp →
# rename). Far safer than sed/awk on JSON. Idempotent: re-running
# preserves any existing agentId the user filled in.
TMP="$(mktemp)"
jq \
  --arg rpc "$DEFAULT_RPC_URL" \
  --arg idx "$DEFAULT_INDEXER_URL" \
  --arg aid "$DEFAULT_AGENTICID" \
  --arg ver "$DEFAULT_VERIFIER" \
  --arg vurl "$DEFAULT_VERIFY_URL_BASE" \
  --argjson cid "$DEFAULT_CHAIN_ID" \
  --arg mid "$DEFAULT_MODEL_ID" \
  --arg agentPlaceholder "$AGENT_ID_PLACEHOLDER" \
  --arg pluginId "$PLUGIN_ID" \
  --arg pluginPath "$PLUGIN_DIR" \
  '
    .plugins //= {} |
    .plugins.entries //= {} |
    .plugins.entries[$pluginId] //= { enabled: true, config: {} } |
    .plugins.entries[$pluginId].enabled = true |
    .plugins.entries[$pluginId].config //= {} |
    .plugins.entries[$pluginId].config.rpcUrl //= $rpc |
    .plugins.entries[$pluginId].config.indexerUrl //= $idx |
    .plugins.entries[$pluginId].config.agenticIdAddress //= $aid |
    .plugins.entries[$pluginId].config.verifierAddress //= $ver |
    .plugins.entries[$pluginId].config.verifyUrlBase //= $vurl |
    .plugins.entries[$pluginId].config.chainId //= $cid |
    .plugins.entries[$pluginId].config.agentId //= $agentPlaceholder |
    .plugins.entries[$pluginId].config.modelId //= $mid |
    .plugins.load //= {} |
    .plugins.load.paths //= [] |
    (if (.plugins.load.paths | index($pluginPath)) == null
       then .plugins.load.paths += [$pluginPath]
       else . end)
  ' "$OPENCLAW_CONFIG" > "$TMP"

mv "$TMP" "$OPENCLAW_CONFIG"
ok "patched $OPENCLAW_CONFIG (backup: $BACKUP)"

# ── Footer — what the user does next ─────────────────────────────────────────
EXISTING_AGENT_ID="$(jq -r ".plugins.entries.\"$PLUGIN_ID\".config.agentId // \"\"" "$OPENCLAW_CONFIG")"
echo
echo "════════════════════════════════════════════════════════════════"
echo " ✅ Plugin installed — three steps left for you:"
echo "════════════════════════════════════════════════════════════════"
echo
echo " 1. Set your agentId in $OPENCLAW_CONFIG:"
if [ "$EXISTING_AGENT_ID" = "$AGENT_ID_PLACEHOLDER" ]; then
  echo "       Currently: $EXISTING_AGENT_ID (placeholder — plugin will be no-op)"
else
  echo "       Currently: $EXISTING_AGENT_ID"
fi
echo "       Set it to any 0x-prefixed 20-byte address — it identifies your agent"
echo "       in the iNFT dataDescription. Suggested: use your wallet address."
echo
echo " 2. Fund the plugin wallet (auto-generated on first run):"
echo "       The plugin creates ~/.openclaw/verifiable-execution/wallet.json on"
echo "       first session-end. Claim 0.1 0G from https://faucet.0g.ai to fund it."
echo "       (Mainnet users: send manually to the address printed on first run.)"
echo
echo " 3. Restart the OpenClaw gateway:"
echo "       openclaw gateway restart"
echo
echo " Then run an OpenClaw session as usual. Every tool call is captured;"
echo " on session-end the log is anchored to AgenticID and you get a"
echo " /verify/<tokenId> URL — share it with anyone."
echo "════════════════════════════════════════════════════════════════"
echo
