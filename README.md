# AGENTSCAN — Verifiable Agent Execution

> **Etherscan for AI agents.** Every agent run becomes a cryptographically signed, on-chain-anchored receipt. Share a URL, verify any run cold.

Live at **[agentscan.online](https://agentscan.online)**. Docs at **[docs.agentscan.online](https://docs.agentscan.online)**.

---

## What you get

Install the AGENTSCAN plugin once in your OpenClaw config. From that moment forward, every agent reply produces a receipt:

- 📝 **Full audit trail** — every tool call (web search, file read, MCP call, anything Claude Code or your agent invokes) is hashed, signed, and recorded
- 🔒 **Encrypted by default** — the receipt is stored encrypted on 0G Storage. The key stays on your machine. You decide who sees the content with a `/share` command in the chat
- ⛓ **On-chain anchor** — the receipt's root hash is minted as an ERC-7857 iNFT on 0G Chain. Tamper-proof, wallet-free verification for anyone
- 🌐 **Cold-verifiable** — paste the URL into any browser. No login, no wallet, no setup. Five live reads flip green checkmarks per row

**Example receipt:** [agentscan.online/verify/112](https://agentscan.online/verify/112) → see a real agent's 4 web searches + LLM response, end-to-end verifiable.

---

## Quickstart (testnet, ~3 minutes)

You need [OpenClaw](https://openclaw.ai) installed, plus Node.js 20+ on your system.

### 1. Install the plugin from npm

```bash
openclaw plugins install @blockchainoracle/openclaw-verifiable-execution
```

### 2. Enable it

```bash
openclaw plugins enable verifiable-execution
```

### 3. Restart the OpenClaw gateway

```bash
openclaw gateway restart
```

The plugin auto-generates a signing wallet on first load and writes it to `~/.openclaw/verifiable-execution/wallet.json` (mode `0o600`, never leaves your machine). The startup banner prints the wallet address — copy it.

### 4. Fund the wallet from the testnet faucet

The plugin needs a few testnet 0G tokens to pay gas when it mints receipts. Without this step, every anchor attempt fails with "insufficient funds for gas."

- Open [faucet.0g.ai](https://faucet.0g.ai)
- Paste the wallet address from step 3
- Claim 0.1 0G (free, daily limit)

### 5. Fire your agent

Send a message to your bot, run a Claude Code session, anything that triggers `agent_end`. The plugin auto-anchors and prints:

```json
{
  "level": "INFO",
  "component": "agent_end",
  "msg": "Session anchored on-chain",
  "data": {
    "tokenId": "42",
    "verifyUrl": "https://agentscan.online/verify/42"
  }
}
```

### 6. Share the receipt

Type `/share` in the chat. The bot replies with a URL containing your reveal key in the URL fragment (`#k=...`). Send that URL to anyone — they decrypt and verify in their browser, your server never sees the key.

> **See all your tokens:** open `https://agentscan.online/agent/<your-wallet-address>` for a feed of every receipt you've ever minted.

For per-flag configuration, mainnet setup, troubleshooting, and the full API → [docs.agentscan.online](https://docs.agentscan.online).

---

## Networks

| Network | chainId | AgenticID | TEE Verifier |
|---|---|---|---|
| **0G Galileo** (testnet) | `16602` | [`0xd4a5eA…0E38`](https://chainscan-galileo.0g.ai/address/0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38) | [`0x058fc3…C3AD`](https://chainscan-galileo.0g.ai/address/0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad) |
| **0G Aristotle** (mainnet) | `16661` | [`0xC6f7fB…8937`](https://chainscan.0g.ai/address/0xC6f7fB1511a7483C6e14258c70529e37ec698937) | [`0x4fffB5…58D2`](https://chainscan.0g.ai/address/0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2) |

Mainnet has no faucet — fund the wallet via a CEX withdrawal to native 0G chain. Everything else stays the same.

---

## Verify a receipt without installing anything

Want to just *see* a proof? No setup required:

- Open any receipt at [agentscan.online/verify/&lt;tokenId&gt;](https://agentscan.online/verify/112)
- Or hit the JSON: [agentscan.online/api/verify/112](https://agentscan.online/api/verify/112)
- Or read the iNFT directly on the explorer: [chainscan-galileo.0g.ai/token/0xd4a5eA…0E38?a=0](https://chainscan-galileo.0g.ai/token/0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38?a=0)

---

## Repo layout (for contributors)

```
apps/
  dashboard/                Next.js 14 verifier UI (agentscan.online)
  docs/                     Nextra docs site (docs.agentscan.online)
plugin/                     THE OpenClaw plugin source (published to npm as
                            @blockchainoracle/openclaw-verifiable-execution)
  src/                      TypeScript source
  tests/                    vitest suites
  dist/                     esbuild bundle output (gitignored, npm-publish target)
  openclaw.plugin.json      OpenClaw manifest (config schema)
  build.mjs                 Bundler — src → dist
packages/                   Shared workspace libraries (used by apps/ + plugin/)
  logger/                   SessionLogger + 0G Storage upload
  tee-adapter/              Signing-message helpers + MockTEEVerifier ABI
  chain-client/             AgenticIDClient + SessionAnchor
contracts/                  AgenticID.sol + MockTEEVerifier.sol (Hardhat)
scripts/                    Top-level utility scripts
  smoke/                    Live testnet smoke tests (re-runnable)
tests/visual/               Playwright visual regression for the dashboard
nixpacks.toml               Multi-target Coolify deploy config (dashboard + docs)
```

See [`STRUCTURE.md`](./STRUCTURE.md) for what each folder is for and why
it lives there.

To build from source:

```bash
git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
cd verifiable-agent-execution
pnpm install
pnpm exec tsc --noEmit && pnpm run lint && pnpm test && pnpm run build
```

Full developer setup, smoke scripts, contract redeployment, and contribution guide → **[docs.agentscan.online/contributing](https://docs.agentscan.online/contributing)**.

---

## Links

- **Live dashboard:** [agentscan.online](https://agentscan.online) (testnet) · [mainnet.agentscan.online](https://mainnet.agentscan.online) (mainnet)
- **Documentation:** [docs.agentscan.online](https://docs.agentscan.online)
- **npm package:** [@blockchainoracle/openclaw-verifiable-execution](https://www.npmjs.com/package/@blockchainoracle/openclaw-verifiable-execution)
- **OpenClaw:** [openclaw.ai](https://openclaw.ai)
- **0G Network:** [0g.ai](https://0g.ai) · [docs.0g.ai](https://docs.0g.ai)
- **Testnet faucet:** [faucet.0g.ai](https://faucet.0g.ai) (0.1 0G/day, Galileo only)

---

## License

Apache-2.0. See [LICENSE](./LICENSE).
