# Installation

> Install the **verifiable-execution** OpenClaw plugin so every agent
> session you run gets captured, flushed to 0G Storage, and anchored
> on-chain as an iNFT — shareable as `https://agentscan.online/verify/<tokenId>`.

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

# After install, you MUST also (a) allowlist the plugin id AND
# (b) grant conversation access — OpenClaw has TWO permission gates
# for non-bundled plugins, and skipping either leaves the plugin in
# a silent no-op state. Combined one-liner:
jq '.plugins.allow = ((.plugins.allow // []) + ["verifiable-execution"] | unique)
    | .plugins.entries."verifiable-execution".hooks //= {}
    | .plugins.entries."verifiable-execution".hooks.allowConversationAccess = true' \
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
  on-chain (the encrypted envelope's rootHash, not plaintext)
- Prints a **KEY-FREE** result to stderr (the reveal key stays in
  the local keystore — no auto-leak to log streams):

```
[verifiable-execution] session anchored: tokenId=42 verifyUrl=https://agentscan.online/verify/42
```

The session's AES-256-GCM key is written to
`~/.openclaw/verifiable-execution/keystore/<tokenId>.key` (literal tokenId — digits only)
(mode 0600). It never appears in stderr, never appears in HTTP
requests to the verifier server, and never leaves your host
unless YOU choose to share it via the `/share` command below.

### Two ways to verify

The printed URL is **key-free**. Anyone clicking it sees a
metadata-only **🔒 Encrypted** view: the rootHash, the iNFT page,
the storage blob link, and the on-chain anchor — the cryptographic
proof chain is fully verifiable cold even without the key. What
they CANNOT see (without your consent): the agent's tool params,
the LLM's outputs, or the user's prompts.

To reveal the content to a recipient:

1. **In your agent's chat (Telegram / Discord / CLI)** — type:

   ```
   /share              ← URL for the most recent receipt
   /share 42           ← URL for a specific tokenId
   ```

   The bot replies with the full share URL, including a
   `#k=<base64url-key>` URL fragment. **Important**: URL fragments
   are NEVER sent in HTTP requests, so the key remains on the
   recipient's device only.

2. **Send the URL via your chosen channel** (DM, email, etc.).

3. **Recipient clicks the link** → dashboard loads the locked
   state, reads the URL fragment in the browser, fetches the
   encrypted envelope from `/api/verify/<id>/blob` (a key-blind
   passthrough), decrypts via WebCrypto, and renders the four
   tool-call cards with their decoded params/results. The
   verify-on-chain badge cascade then runs entirely in the
   browser via ethers — confirming each entry's signature against
   our deployed `MockTEEVerifier`.

   The verifier server **never** sees the key. The decryption
   happens fully client-side; the server only serves the
   encrypted bytes and the public iNFT metadata.

The dashboard's three live reads behind the scenes:

1. `AgenticID.getIntelligentDatas(tokenId)` → fetches the stored
   `dataDescription` + `dataHash` for the session
2. **0G Storage download** of the encrypted envelope identified by
   that rootHash (no decryption — pure passthrough)
3. `MockTEEVerifier.verifyTEESignature(...)` for each entry's
   signature — run client-side in the browser for encrypted
   receipts, server-side for legacy plaintext receipts

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

**Two permission gates (BOTH REQUIRED — discovered on VPS E2E):**
OpenClaw 2026.4.25 has two independent gates that block non-bundled
plugins from working until the operator explicitly opts in. Each
gate fails silently — the plugin loads, registers, appears in
`plugins list` as enabled, but its hooks never receive events.

| Gate | What it blocks | Where to set |
|---|---|---|
| `plugins.allow` | Plugin loading + ANY event dispatch | top-level `plugins.allow: ["verifiable-execution"]` |
| `hooks.allowConversationAccess` | Hooks that read message content (llm_output, agent_end, after_tool_call) | `plugins.entries.verifiable-execution.hooks.allowConversationAccess: true` |

`./install.sh` sets both automatically. If you installed via raw
`openclaw plugins install <pkg>` (skipping the script), run this
yourself:

```bash
jq '.plugins.allow = ((.plugins.allow // []) + ["verifiable-execution"] | unique)
    | .plugins.entries."verifiable-execution".hooks //= {}
    | .plugins.entries."verifiable-execution".hooks.allowConversationAccess = true' \
  ~/.openclaw/openclaw.json > /tmp/cfg.json && mv /tmp/cfg.json ~/.openclaw/openclaw.json
openclaw gateway restart
```

Verify with:

```bash
jq '.plugins.allow, .plugins.entries."verifiable-execution".hooks' ~/.openclaw/openclaw.json
# Must output: ["verifiable-execution", ...] and {"allowConversationAccess": true}
```

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
[verifiable-execution] session anchored: tokenId=42 verifyUrl=https://agentscan.online/verify/42
```

Open that **key-free** URL in a browser. v0.3.0 encrypts receipts
by default, so a cold visitor (anyone with just the URL — no
`#k=` fragment) sees a **🔒 Encrypted** locked-state page:

- **Session header** — tokenId + on-chain anchor (sessionId is
  visible from the dataDescription; the agent identity is the iNFT
  owner address)
- **Per-entry decoded params + result** are **HIDDEN** — visible
  only after the operator types `/share` in the bot chat and shares
  the resulting `…/verify/<id>#k=<key>` URL with the recipient
- **0G Storage** badge — links to the (encrypted) rootHash on the
  indexer; the cryptographic proof chain is verifiable cold
- **AgenticID** badge — links to the iNFT on Galileo explorer

To see the decoded entries, the operator runs `/share` (or
`/share <tokenId>`) in the bot chat. The bot replies with a full
URL including `#k=<base64url>`. Recipients who open that URL get
client-side WebCrypto decryption in their browser — the
**TEE Verified** badges then flip green sequentially as
client-side ethers calls `MockTEEVerifier.verifyTEESignature` per
entry. The reveal key never leaves the recipient's device.

---

## Mainnet mode

To anchor proofs to **Aristotle mainnet** (chainId 16661) instead of
Galileo, set the env vars before running `./install.sh`:

```bash
RPC_URL=https://evmrpc.0g.ai \
INDEXER_URL=https://indexer-storage-turbo.0g.ai \
AGENTICID_ADDRESS=0xC6f7fB1511a7483C6e14258c70529e37ec698937 \
TEE_VERIFIER_ADDRESS=0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2 \
VERIFY_URL_BASE=https://mainnet.agentscan.online \
CHAIN_ID=16661 \
./install.sh
```

Note the **subdomain split**: testnet at `agentscan.online`, mainnet at
`mainnet.agentscan.online`. The URL path is identical
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
