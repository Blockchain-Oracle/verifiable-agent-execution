# Installation

> Install the **verifiable-execution** OpenClaw plugin so every agent
> session you run gets captured, flushed to 0G Storage, and anchored
> on-chain as an iNFT — shareable as `https://verifiable.0g.ai/verify/<tokenId>`.

The plugin runs entirely inside OpenClaw — no separate service, no
Docker, no Python. One install command, one config edit, one gateway
restart.

---

## Prerequisites

| Requirement | macOS | Ubuntu / Debian |
|---|---|---|
| [OpenClaw CLI](https://openclaw.ai) (≥ 2026.5.0) | required | required |
| Node.js 20+ | `brew install node@20` | use [`nvm`](https://github.com/nvm-sh/nvm) or `apt-get install nodejs` |
| pnpm 9+ (optional) | `npm i -g pnpm` | `npm i -g pnpm` |
| `jq` | `brew install jq` | `apt-get install jq` |
| `git` | preinstalled | `apt-get install git` |
| Funded 0G testnet wallet | claim 0.1 0G/day at [faucet.0g.ai](https://faucet.0g.ai) | same |

> If you want to anchor to **mainnet** (Aristotle, chainId 16661) you'll
> need real OG tokens — there is no mainnet faucet. See
> [#mainnet-mode](#mainnet-mode) at the bottom.

---

## Install (testnet — default)

```bash
git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
cd verifiable-agent-execution
./install.sh
openclaw gateway restart
```

`./install.sh` handles `pnpm install --frozen-lockfile` for you —
the plugin imports `ethers` and our chain client, so workspace deps
have to be on disk before OpenClaw's jiti loader can load us. If
`pnpm` isn't on your PATH the installer falls back to `npx -y
pnpm@9.15.4`, so the only hard runtime requirement is Node.js 20+.

The script is idempotent — re-run as many times as you like; it
never clobbers an existing `agentId` you've set.

### What `install.sh` does

1. **Installs workspace deps** via pnpm (or `npx pnpm@9.15.4` fallback).
2. **Bundles the plugin** with esbuild into a self-contained
   `dist-plugin/verifiable-execution/index.js` (no node_modules, no
   workspace symlinks) — bypasses OpenClaw's safety scan.
3. **Generates a fresh wallet** at
   `~/.openclaw/verifiable-execution/wallet.json` (mode 0600) and
   uses its address as the default `agentId`.
4. **Seeds the config block** at
   `~/.openclaw/openclaw.json:plugins.entries.verifiable-execution.config`
   with Galileo testnet defaults (RPC, indexer, contract addresses,
   chainId, modelId, agentId = the generated wallet).
5. **Links the plugin** via `openclaw plugins install --link` against
   the bundled output.
6. **Enables it** via `openclaw plugins enable verifiable-execution`.
7. **Backs up** the original `openclaw.json` to
   `~/.openclaw/openclaw.json.bak.<date>` before any edit.

That's it — no manual edits required. The end of `install.sh` prints
your wallet address; fund it once at the faucet and you're done.

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
A: Check `~/.openclaw/openclaw.json` — every key in `configSchema.required`
must be set. The most common miss is `agentId` left at the zero-address
placeholder. The plugin intentionally no-ops in that case to prevent
silent mis-tagged proofs from being minted.

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
