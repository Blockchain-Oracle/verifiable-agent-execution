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
# Source (workspace) location — what we type-check + test against:
PLUGIN_SRC_DIR="$SCRIPT_DIR/openclaw-skills/$PLUGIN_ID"
# Bundled location — what we actually --link into OpenClaw. The bundle
# is self-contained (esbuild inlines ethers + the 0G SDK + workspace
# packages) so the install dir has no node_modules at all, which is
# what OpenClaw's safety scan expects from a `--link` target.
PLUGIN_DIR="$SCRIPT_DIR/dist-plugin/$PLUGIN_ID"
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

[ -d "$PLUGIN_SRC_DIR" ] || fail "Plugin source not found at $PLUGIN_SRC_DIR"
[ -f "$PLUGIN_SRC_DIR/openclaw.plugin.json" ] || fail "Missing $PLUGIN_SRC_DIR/openclaw.plugin.json"
[ -f "$PLUGIN_SRC_DIR/build.mjs" ] || fail "Missing build script at $PLUGIN_SRC_DIR/build.mjs"

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

# ── Step 0a: install workspace deps (so the build script can bundle them)
# Our plugin imports `@verifiable-agent-execution/chain-client` (workspace:*)
# and `ethers` — both have to be on disk for esbuild to inline them.
echo
info "Step 0a/3 — installing workspace dependencies"
( cd "$SCRIPT_DIR" && "${PNPM_CMD[@]}" install --frozen-lockfile 2>&1 | tail -5 | sed 's/^/    /' )
ok "deps installed"

# ── Step 0b: bundle the plugin into a self-contained dist
# esbuild inlines ethers, the 0G storage SDK, and the workspace packages
# into one ESM file at `dist-plugin/verifiable-execution/index.js`. The
# dist dir has no `node_modules/` at all, which sidesteps OpenClaw's
# symlink-outside-install-root safety scan that blocked our first `--link`
# attempt on the VPS (the workspace dir's node_modules has pnpm-store
# symlinks). This same dist is the artifact we npm-publish.
echo
info "Step 0b/3 — building self-contained plugin bundle"
( cd "$PLUGIN_SRC_DIR" && "${PNPM_CMD[@]}" run build 2>&1 | tail -8 | sed 's/^/    /' )
[ -f "$PLUGIN_DIR/index.js" ] \
  || fail "Bundle build produced no index.js at $PLUGIN_DIR — see output above"
[ -f "$PLUGIN_DIR/openclaw.plugin.json" ] \
  || fail "Bundle missing openclaw.plugin.json at $PLUGIN_DIR"
ok "bundled to $PLUGIN_DIR"

# ── Step 0c: pre-generate the plugin wallet so we can use its address
# as the default agentId. The plugin's own wallet.ts will create the
# file lazily on first session-end, but doing it here lets us thread
# the wallet address into the config as agentId — meaning the user has
# NOTHING to edit after install. True zero-config for the hackathon
# demo flow. If a wallet already exists (re-run case) we just read it.
echo
info "Step 0c/3 — initializing plugin wallet (so agentId can be auto-set)"
WALLET_DIR="$HOME/.openclaw/$PLUGIN_ID"
mkdir -p "$WALLET_DIR"
chmod 700 "$WALLET_DIR" 2>/dev/null || true
WALLET_FILE="$WALLET_DIR/wallet.json"

if [ ! -f "$WALLET_FILE" ]; then
  # Use ethers via the installed workspace deps. Stay in $SCRIPT_DIR so
  # Node resolves `ethers` from the repo's node_modules. The file
  # layout matches what openclaw-skills/verifiable-execution/src/wallet.ts
  # writes itself — same keys, same mode 0600.
  ( cd "$SCRIPT_DIR" && node --input-type=module -e "
    import { Wallet } from 'ethers';
    import { writeFileSync } from 'node:fs';
    const w = Wallet.createRandom();
    const body = JSON.stringify({
      privateKey: w.privateKey,
      address: w.address,
      createdAt: new Date().toISOString(),
      network: 'galileo-testnet'
    }, null, 2);
    writeFileSync('$WALLET_FILE', body, { mode: 0o600 });
    process.stdout.write(w.address);
  " > /dev/null )
  chmod 600 "$WALLET_FILE"
  ok "generated fresh wallet at $WALLET_FILE"
else
  ok "reusing existing wallet at $WALLET_FILE"
fi

PLUGIN_WALLET_ADDRESS="$(jq -r '.address' "$WALLET_FILE")"
ok "wallet address: $PLUGIN_WALLET_ADDRESS"

# ── Step 1: seed config FIRST (openclaw validates on install) ────────────────
# OpenClaw 2026.4.25 runs configSchema validation against the existing
# entry as part of `plugins install`. If the block is missing, install
# fails with "must have required property 'rpcUrl'…". So we patch the
# config block BEFORE linking.
echo
info "Step 1/3 — seeding ~/.openclaw/openclaw.json with network defaults"

mkdir -p "$(dirname "$OPENCLAW_CONFIG")"
[ -f "$OPENCLAW_CONFIG" ] || echo '{}' > "$OPENCLAW_CONFIG"

# Backup once per day so a botched re-run is recoverable.
BACKUP="$OPENCLAW_CONFIG.bak.$(date +%Y%m%d)"
[ -f "$BACKUP" ] || cp "$OPENCLAW_CONFIG" "$BACKUP"

# Use the plugin's auto-generated wallet address as the default agentId.
# The user can override this in openclaw.json to bind the proofs to a
# different identity, but the default means there's NO required edit
# after install — true zero-config.
DEFAULT_AGENT_ID="$PLUGIN_WALLET_ADDRESS"

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
  --arg agentDefault "$DEFAULT_AGENT_ID" \
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
    # Treat a missing OR zero-address agentId as "not set". A user who
    # set a real custom agentId on a previous run keeps their value;
    # someone re-running after a stale placeholder gets the wallet
    # auto-bound. (Without this, `//=` would preserve the zero address
    # forever once written, leaving the plugin permanently no-op.)
    .plugins.entries[$pluginId].config.agentId =
      (
        (.plugins.entries[$pluginId].config.agentId // "") as $existing |
        if ($existing == "") or ($existing | test("^0x0+$"; "i"))
          then $agentDefault
          else $existing
        end
      ) |
    .plugins.entries[$pluginId].config.modelId //= $mid |
    .plugins.load //= {} |
    .plugins.load.paths //= [] |
    (if (.plugins.load.paths | index($pluginPath)) == null
       then .plugins.load.paths += [$pluginPath]
       else . end) |
    # CRITICAL: add to plugins.allow so OpenClaw actually dispatches
    # events to our handlers. Without this, the plugin LOADS (shows up
    # in `plugins list` as enabled) but its api.on() subscriptions never
    # fire — the gateway sandboxes "non-bundled discovered" plugins by
    # default and only allowlisted ids get the event stream. We learned
    # this the hard way on the VPS E2E: 8 sessions, nonce 0, no anchor.
    .plugins.allow = ((.plugins.allow // []) + [$pluginId] | unique) |
    # SECOND CRITICAL gate: OpenClaw blocks "conversation-reading" hooks
    # (llm_output, agent_end, after_tool_call, message_received, ...) for
    # non-bundled plugins unless the operator explicitly opts in. Without
    # this, the gateway log shows:
    #   "[plugins] typed hook \"llm_output\" blocked because non-bundled
    #    plugins must set plugins.entries.<id>.hooks.allowConversationAccess=true"
    # …and our anchor hooks never fire even though `plugins.allow` is set.
    # This is the sane default — verifiable-execution genuinely reads the
    # agent's responses to hash + attest them, so flipping the bit is the
    # right answer; just doing it in code so operators don't hit two
    # consecutive silent-no-op gates.
    .plugins.entries[$pluginId].hooks //= {} |
    .plugins.entries[$pluginId].hooks.allowConversationAccess = true
  ' "$OPENCLAW_CONFIG" > "$TMP"

mv "$TMP" "$OPENCLAW_CONFIG"
ok "patched $OPENCLAW_CONFIG (backup: $BACKUP)"

# ── Step 2: link the bundled plugin into OpenClaw ────────────────────────────
# The dist-plugin/ output is self-contained (esbuild inlined every npm
# dep) so OpenClaw's symlink-outside-install-root safety scan passes.
echo
info "Step 2/3 — linking plugin into OpenClaw"
if openclaw plugins install --link "$PLUGIN_DIR" 2>&1 | sed 's/^/    /'; then
  ok "linked $PLUGIN_ID"
else
  fail "'openclaw plugins install --link' failed — see output above"
fi

# ── Step 3: enable the plugin ────────────────────────────────────────────────
echo
info "Step 3/3 — enabling plugin"
if openclaw plugins enable "$PLUGIN_ID" 2>&1 | sed 's/^/    /'; then
  ok "enabled $PLUGIN_ID"
else
  # Non-fatal — may already be enabled from a previous run.
  warn "'openclaw plugins enable' exited non-zero (probably already enabled)"
fi

# ── Footer — what the user does next ─────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo " ✅ Plugin installed — two steps left:"
echo "════════════════════════════════════════════════════════════════"
echo
echo " 1. Fund the plugin wallet (one-time, free on testnet):"
echo
echo "       Address:  $PLUGIN_WALLET_ADDRESS"
echo "       Network:  Galileo testnet (chainId $DEFAULT_CHAIN_ID)"
echo "       Faucet:   https://faucet.0g.ai"
echo
echo "       Paste the address above, claim 0.1 0G. Mainnet users:"
echo "       send 0G directly to the address from any exchange."
echo
echo " 2. Restart the OpenClaw gateway:"
echo
echo "       openclaw gateway restart"
echo
echo " Then run an OpenClaw session as usual. Every tool call is captured;"
echo " on session-end the log is anchored to AgenticID and you get a"
echo " /verify/<tokenId> URL — share it with anyone."
echo
echo " (Advanced) Override agentId by editing $OPENCLAW_CONFIG —"
echo " currently set to the plugin's wallet address."
echo "════════════════════════════════════════════════════════════════"
echo
