# Installation

> Install the **verifiable-execution** OpenClaw plugin so every agent
> session you run gets captured, flushed to 0G Storage, and anchored
> on-chain as an iNFT — shareable as `https://verifiable.0g.ai/verify/<tokenId>`.

The plugin runs entirely inside OpenClaw — no separate service, no
Docker, no Python. One install command, fund a wallet, one gateway
restart. Done.

---

## Prerequisites

| Requirement | macOS | Ubuntu / Debian |
|---|---|---|
| [OpenClaw CLI](https://openclaw.ai) (≥ 2026.4.25) | required | required |
| Node.js 20+ | `brew install node@20` | use [`nvm`](https://github.com/nvm-sh/nvm) or `apt-get install nodejs` |
| Funded 0G testnet wallet | claim 0.1 0G/day at [faucet.0g.ai](https://faucet.0g.ai) | same |

> If you want to anchor to **mainnet** (Aristotle, chainId 16661) you'll
> need real OG tokens — there is no mainnet faucet. See
> [#mainnet-mode](#mainnet-mode) at the bottom.

---

## Install — one command (testnet, the default)

```bash
openclaw plugins install @blockchainoracle/openclaw-verifiable-execution
# (NOT `npm:@blockchainoracle/...` — the npm: prefix is rejected on
# OpenClaw 2026.4.25 with "protocol specs are not allowed". The bare
# spec resolves through ClawHub which proxies the same npm registry.)

# After install, you MUST also allowlist the plugin id OR the gateway
# silently won't dispatch events to it (the plugin LOADS but never
# fires hooks). One-liner:
jq '.plugins.allow = ((.plugins.allow // []) + ["verifiable-execution"] | unique)' \
  ~/.openclaw/openclaw.json > /tmp/cfg.json && mv /tmp/cfg.json ~/.openclaw/openclaw.json
openclaw gateway restart
```

That's it. The plugin is now wired into every OpenClaw session you
run — every tool call gets captured, every session-end is flushed to
0G Storage and anchored as an iNFT on AgenticID.

### What just happened

OpenClaw pulled the tarball from npm
([@blockchainoracle/openclaw-verifiable-execution](https://www.npmjs.com/package/@blockchainoracle/openclaw-verifiable-execution)),
extracted it to `~/.openclaw/extensions/verifiable-execution/`, and
added a config block to `~/.openclaw/openclaw.json` with Galileo
testnet defaults baked into the plugin code (RPC, indexer, contract
addresses, chainId, modelId).

When you run your first OpenClaw session, the plugin:

1. **Auto-generates a signing wallet** at
   `~/.openclaw/verifiable-execution/wallet.json` (mode 0600)
2. **Auto-binds `agentId` to that wallet's address** — the wallet IS
   the agent identity by default
3. **Prints a one-time first-run banner** with the wallet address +
   faucet URL

### Fund the wallet

Look for a banner in your OpenClaw stderr that looks like:

```
═══════════════════════════════════════════════════════════════
  Verifiable Execution — First Run Setup
═══════════════════════════════════════════════════════════════

  Wallet:    0xC156E52882b4AF03f2FFe96374ccB46bbc639103
  Network:   0G Galileo testnet (chainId 16602)

  Fund this wallet ONCE so the plugin can mint proofs:
    1. Visit https://faucet.0g.ai
    2. Paste your address
    3. Claim 0.1 0G (free, daily limit)
```

Send 0.1 0G to that address. After it lands (~10 seconds on Galileo),
every subsequent session anchors automatically and prints a
`/verify/<tokenId>` URL you can share with anyone.

If you'd rather find the address WITHOUT running a session first:

```bash
# Address is printed by openclaw itself if you `plugins enable` again:
openclaw plugins enable verifiable-execution

# Or just read it directly:
jq -r .address ~/.openclaw/verifiable-execution/wallet.json
```

---

## How it works after install — what you'll actually see

This is the most-asked question from new users, so here's the
complete picture.

### Nothing changes about how you use OpenClaw

You don't tell agents to "use the plugin". You don't pass a flag.
You don't change any prompt. The plugin attaches itself to the
OpenClaw event loop as a **passive listener** — every time the
runtime fires an `after_tool_call` or `session_end` event for any
agent, the plugin gets notified out of band.

Run any OpenClaw command exactly the way you would without the
plugin installed:

```bash
openclaw query "Quote a USDC→ETH swap on 0G with 50 bps max slippage"
```

While the agent runs, the plugin silently:

- Hashes the params + result of every tool call (sha256, no
  plaintext leaves your machine)
- Buffers the hashed entries in memory under a sessionId
- On `session_end`, flushes the buffer to **0G Storage**, gets back
  a Merkle rootHash
- Mints an **AgenticID iNFT** (ERC-7857) anchoring that rootHash
  on-chain
- Prints the result to stderr:

```
[verifiable-execution] session anchored: tokenId=42 verifyUrl=https://verifiable.0g.ai/verify/42
```

### You share the URL — anyone can verify it cold

Open the printed URL in any browser. No wallet, no auth, no install
required to verify. The dashboard runs three live reads against
0G:

1. `AgenticID.getIntelligentDatas(tokenId)` → fetches the stored
   `dataDescription` + `dataHash` for the session
2. **0G Storage download** of the log identified by that rootHash
3. `MockTEEVerifier.verifyTEESignature(...)` for each entry's
   signature

All three pass → 4 green badges on the page → "this agent really
did execute these tool calls, in this order, with these results."

### Multiple agents / multiple channels

Every OpenClaw session — no matter which channel triggered it
(CLI, Telegram bot, Discord bot, Slack, web, anything you wire up
to your gateway) — gets anchored. Sessions are keyed by OpenClaw's
own `sessionId`, so each conversation produces its own iNFT.

---

## Restarting the gateway

OpenClaw loads installed plugins at gateway-start time. After
`openclaw plugins install <...>` you have to restart for the change
to take effect:

```bash
openclaw gateway restart
```

If the gateway wasn't running, start it instead:

```bash
openclaw gateway start
```

You can confirm the plugin loaded with:

```bash
openclaw plugins list
# Should show: verifiable-execution | enabled | 0.1.1
```

> **Note on restart timing:** `gateway restart` defers if there's an
> active task run (you'll see "restart still deferred after Xms with
> N task run(s) active" in the log). It can take 30 seconds to
> several minutes for the actual SIGTERM to fire. To force-restart
> immediately, kill the gateway process: `pkill -TERM -f 'openclaw'`
> — supervisor will restart it.

**Allowlist (REQUIRED — not optional):** OpenClaw 2026.4.25 silently
quarantines event dispatch for "non-bundled discovered" plugins
unless their id is in `plugins.allow`. The plugin will install and
appear as enabled in `openclaw plugins list`, but its `api.on()`
handlers will never receive events — so no anchor will ever happen.

`./install.sh` adds the allowlist entry automatically. If you
installed via raw `openclaw plugins install <pkg>` (skipping the
script), you must run this yourself:

```bash
jq '.plugins.allow = ((.plugins.allow // []) + ["verifiable-execution"] | unique)' \
  ~/.openclaw/openclaw.json > /tmp/cfg.json && mv /tmp/cfg.json ~/.openclaw/openclaw.json
openclaw gateway restart
```

Verify with `jq '.plugins.allow' ~/.openclaw/openclaw.json` — the
output must include `"verifiable-execution"`.

---

## Install from source (for plugin contributors)

If you're hacking on the plugin code itself, clone + `./install.sh`
links the local workspace build:

```bash
git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
cd verifiable-agent-execution
./install.sh
openclaw gateway restart
```

`./install.sh` runs `pnpm install` (falls back to `npx pnpm@9.15.4`
if pnpm isn't on PATH), builds a self-contained ESM bundle via
esbuild, links it via `openclaw plugins install --link`, and seeds
the same Galileo defaults in `~/.openclaw/openclaw.json`. The script
is idempotent — re-run after any source change.

The npm-published artifact and `./install.sh` end up structurally
identical (same bundled `index.js`, same `openclaw.plugin.json`,
same config block). The only difference is "where the bytes came
from".

---

## Optional — bind proofs to a different identity

By default the plugin's auto-generated wallet doubles as `agentId` —
so the iNFT recipient and the proof's claimed identity are the same.
For most use cases this is what you want.

If you want the proof to claim a different identity (e.g. your
human-owned ENS-resolvable address), edit
`~/.openclaw/openclaw.json` and set:

```json
"plugins": {
  "entries": {
    "verifiable-execution": {
      "config": {
        "agentId": "0xYourPreferredAddress..."
      }
    }
  }
}
```

The `agentId` is baked into the iNFT `dataDescription` so anyone
reading the proof on-chain can attribute the run to that identity.
Then `openclaw gateway restart` to pick up the change.

---

## First-run wallet

The plugin auto-creates a signing wallet on first session-end and
writes it to:

```
~/.openclaw/verifiable-execution/wallet.json   (mode 0600)
```

The first session log will print the wallet address to stderr along
with a friendly faucet link. **Send the wallet 0.1 0G before it can
anchor anything** — uploads to 0G Storage and the AgenticID `iMint`
call both cost gas.

To bring your own key instead, set `PRIVATE_KEY` in your shell
environment before launching OpenClaw:

```bash
export PRIVATE_KEY=0x<your-funded-key>
openclaw gateway restart
```

The plugin checks `process.env.PRIVATE_KEY` first; falls back to the
auto-generated wallet otherwise.

---

## Verify the install

Run any OpenClaw session that calls at least one tool. On
`session_end` the plugin will flush the log and mint an iNFT. You
should see a stderr line like:

```
[verifiable-execution] session anchored: tokenId=42 verifyUrl=https://verifiable.0g.ai/verify/42
```

Open that URL in a browser. You'll see:

- **Session header** — sessionId, agentId, modelId, entry count
- **Per-entry decoded params + result** with seq, timestamp, tool name
- **TEE Verified** badge if signatures recover to the configured
  oracle (`MockTEEVerifier.teeOracleAddress`)
- **0G Storage** badge — links to the rootHash on the indexer
- **AgenticID** badge — links to the iNFT on Galileo explorer

---

## Mainnet mode

To anchor proofs to **Aristotle mainnet** (chainId 16661) instead of
Galileo, set the env vars before running `./install.sh`:

```bash
RPC_URL=https://evmrpc.0g.ai \
INDEXER_URL=https://indexer-storage-turbo.0g.ai \
AGENTICID_ADDRESS=0xC6f7fB1511a7483C6e14258c70529e37ec698937 \
TEE_VERIFIER_ADDRESS=0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2 \
VERIFY_URL_BASE=https://mainnet.verifiable.0g.ai \
CHAIN_ID=16661 \
./install.sh
```

Note the **subdomain split**: testnet at `verifiable.0g.ai`, mainnet at
`mainnet.verifiable.0g.ai`. The URL path is identical
(`/verify/<tokenId>`) — only the host carries the network signal.
This is the Etherscan model (see ADR-12).

---

## Uninstall

```bash
openclaw plugins disable verifiable-execution
openclaw plugins uninstall verifiable-execution
openclaw gateway restart
```

This leaves `~/.openclaw/verifiable-execution/wallet.json` in place
so anchored sessions don't lose their key. Delete it manually if you
want a clean slate.

---

## Troubleshooting

**Q: `openclaw: command not found`**
A: Install the OpenClaw CLI per https://openclaw.ai. After install,
verify with `openclaw --version`. If you have `~/.openclaw/` but no
binary on `$PATH`, add `~/.openclaw/bin` to your `$PATH`.

**Q: Plugin loads in "degraded mode" — sessions don't anchor**
A: Every config field has a Galileo testnet default, so the only way
to hit degraded mode is to supply an **invalid override** in
`~/.openclaw/openclaw.json` (e.g. a non-0x-prefixed `agentId`, or a
malformed contract address). Check the plugin's stderr at startup —
it logs a structured warning naming every invalid field. Fix the
value or delete it (deleted = default applies) and restart the
gateway.

**Q: `iMint` reverts with `insufficient funds`**
A: Your plugin wallet (auto-generated or `PRIVATE_KEY`-overridden)
isn't funded. On testnet, claim 0.1 0G at https://faucet.0g.ai. On
mainnet, send OG tokens manually to the wallet address printed in
session-end logs.

**Q: Verify URL shows red badges**
A: All three checks must pass for green:
- TEE signatures recover to the contract's `teeOracleAddress`
- 0G Storage rootHash matches what the iNFT recorded
- AgenticID `getIntelligentDatas(tokenId)` returns the expected entries
Click any red badge for the exact RPC call output.

**Q: I want to run my agent on its own wallet**
A: Set the plugin's `privateKeyEnvVar` config field to a custom name
(e.g. `PRIVATE_KEY_AGENT_A`) and export that var in the shell that
launches OpenClaw. Multiple agents on one host can each have their
own key.

---

## Architecture references

- [ADR-04](../context/docs/architecture.md#adr-04) — plugin format
  (`openclaw.plugin.json` + `src/index.ts`)
- [ADR-08](../context/docs/architecture.md#adr-08) — iNFT
  `dataDescription` convention (`exec-log:<sessionId>:<modelId>`)
- [ADR-10](../context/docs/architecture.md#adr-10) — TEE-rooted, not
  trustless framing
- [ADR-12](../context/docs/architecture.md#adr-12) — subdomain split
  for network routing
- [ADR-13](../context/docs/architecture.md#adr-13) — our own AgenticID
  deploy (not 0G's example)
