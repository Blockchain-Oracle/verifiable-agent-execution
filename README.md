# Verifiable Agent Execution

> **Etherscan for AI agents — share a URL, verify any agent run cold.**

**Hackathon:** 0G APAC Hackathon 2026 — Track 1 (Agentic Infrastructure & OpenClaw Lab)
**Deadline:** May 16, 2026

---

## The wedge

AI agents act autonomously. Today, there's no way to prove what one actually did. Anyone can claim an agent ran a task correctly; no one can verify it.

**Verifiable Agent Execution** is an OpenClaw plugin + dashboard that produces a cryptographically signed, on-chain-anchored proof for every agent session. The proof chain:

```
Tool call (params + result)
   ↓
TEE signature (agent-wrapper, recovered against deployed verifier)
   ↓
SessionLog (full content, sha256-hashed, JSON)
   ↓
0G Storage (rootHash anchored)
   ↓
ERC-7857 iNFT mint on AgenticID (Galileo)
   ↓
Verifier dashboard (open URL → see the story → click "Verify on chain"
                    → 4 row badges flip green sequentially)
```

Anyone clicks the URL on any device — no wallet, no login, no setup. Etherscan UX for agent runs.

---

## Try it (live, on Galileo testnet)

> **Pre-minted demo session — tokenId 0 — DeFi swap simulator (4 signed steps), anchored to OUR AgenticID.**

```bash
# 1. Clone + install (one shot)
git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
cd verifiable-agent-execution
pnpm install

# 2. Start the dashboard (zero env vars needed — constants baked in)
pnpm --filter @verifiable-agent-execution/dashboard dev

# 3. Open the demo proof
open http://localhost:3000/verify/0
```

You'll see the 4-step DeFi swap session, fully decoded (`quote → liquidity → simulate-swap → final-approval`) with green TEE Verified badges flipping in sequence.

---

## Mint your own session

```bash
# Set up your wallet — first run AUTO-creates one
pnpm --filter @verifiable-agent-execution/openclaw-skill exec node -e "import('./src/wallet.js').then(m => m.printFirstRunBanner(m.resolveWallet()))"

# It prints something like:
#   Wallet:    0xABC...
#   Saved to:  ~/.openclaw/verifiable-execution/wallet.json
#   Fund:      Visit https://faucet.0g.ai → paste 0xABC... → claim 0.1 0G

# After funding (one-time), every OpenClaw session you run with this
# plugin enabled will auto-anchor and print a /verify/<tokenId> URL.
```

---

## 0G primitives integrated

| Primitive | Role |
|---|---|
| **0G Storage** | Immutable session log blob (rootHash anchored on-chain) |
| **0G Chain** | EVM-compatible RPC for the AgenticID + verifier contracts |
| **AgenticID (ERC-7857 iNFT)** | Per-session proof token. **Galileo: `0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38` (OUR deploy, Epic-7).** Mainnet: see Deployments section below. |
| **TEE Verifier (MockTEEVerifier.sol)** | Our deploy. **Galileo: `0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad`** — `verifyTEESignature(bytes32,bytes)` view function with `teeOracleAddress = deployer wallet`. |
| **0G Compute Network** (TeeML) | Per-session inference call via `@0gfoundation/0g-compute-ts-sdk`. See `scripts/smoke/defi-swap-demo-with-compute.ts`. |
| **agent-wrapper signing convention** | `keccak256(agentId\|sealId\|signedAt\|bodyHashHex)` per the upstream Go signSession code |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  OpenClaw                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ verifiable-execution plugin (openclaw-skills/verifiable-execution)│ │
│  │   • register(api): wires api.on("after_tool_call", session_end)  │ │
│  │   • after_tool_call: appendEntry(seq, ts, tool, params, result,  │ │
│  │                                  inputHash, outputHash, teeSig)  │ │
│  │   • session_end: SessionAnchor.anchor() → mint iNFT              │ │
│  │   • Wallet: ~/.openclaw/verifiable-execution/wallet.json (auto)  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  packages/  (TypeScript workspaces)                                    │
│  • logger        SessionLogger + StorageClient + schema               │
│  • tee-adapter   HeaderParser + signing-message + MockTEEVerifier ABI │
│  • chain-client  AgenticIDClient + SessionAnchor + retryMint          │
│  • contracts     MockTEEVerifier.sol (Solidity 0.8.24, evm cancun)    │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  apps/dashboard  (Next.js 14 App Router, dark, Geist, zero-config)    │
│  • /                       Landing                                    │
│  • /verify/[tokenId]       Proof chain page (server component)        │
│  • /api/verify/[tokenId]   Aggregate proof JSON                       │
│  • /api/verify/[tokenId]/entry/[seq]   Per-entry verify (badge flip)  │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│  0G Galileo testnet (chainId 16602)                                    │
│  • AgenticID:        0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38       │
│  • MockTEEVerifier:  0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad       │
│  • Storage indexer:  https://indexer-storage-testnet-turbo.0g.ai      │
│  • Demo session:     tokenId 0 (4 signed entries, all TEE Verified)   │
└────────────────────────────────────────────────────────────────────────┘
```

## Deployments

| Network | Chain ID | Status | AgenticID | MockTEEVerifier |
|---|---|---|---|---|
| **Galileo (testnet)** | 16602 | LIVE | [`0xd4a5eA…0E38`](https://chainscan-galileo.0g.ai/address/0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38) | [`0x058fc3…C3AD`](https://chainscan-galileo.0g.ai/address/0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad) |
| **Aristotle (mainnet)** | 16661 | **LIVE** | [`0xC6f7fB…8937`](https://chainscan.0g.ai/address/0xC6f7fB1511a7483C6e14258c70529e37ec698937) | [`0x4fffB5…58D2`](https://chainscan.0g.ai/address/0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2) |

**Mainnet demo session:** tokenId 0 on [`0xC6f7fB…8937`](https://chainscan.0g.ai/token/0xC6f7fB1511a7483C6e14258c70529e37ec698937?a=0). Five anchored entries:
- `seq 0` — REAL 0G Compute TeeML inference (qwen3.6-plus, provider `0x992e6396…`, verifiability `TeeML`)
- `seq 1-4` — signed DeFi swap tool calls (quote, liquidity, simulate-swap, final-approval)
- Mint tx: [`0xd1b14b30…dfb6d152`](https://chainscan.0g.ai/tx/0xd1b14b30894a91e160e35b70e2f834920fe85d0cee8cc24e19f677b4dfb6d152)
- 0G Storage rootHash: `0xecb433f7b311cd5c4313035c156d42df153f0283391af73f4f297758cff3022c`

Mainnet deploy will land both contracts via `pnpm --filter @verifiable-agent-execution/contracts deploy:all:mainnet`. See `context/docs/architecture.md` ADR-13 for why we deploy our own AgenticID instead of relying on 0G's testnet example.

---

## Zero-config UX

Inspired by [xlmtools](https://github.com/Blockchain-Oracle/xlmtools)'s wallet-on-first-run pattern.

| What | How |
|---|---|
| **Dashboard** | 0 env vars required. Galileo addresses + RPC are compiled-in constants. Override via env to self-host on mainnet |
| **Plugin wallet** | First run auto-creates a wallet at `~/.openclaw/verifiable-execution/wallet.json` (mode 0o600). Friendly banner with faucet URL. PRIVATE_KEY env stays as advanced override |
| **Verifier contract** | Pre-deployed by us. Plugin and dashboard both know the address — operators don't configure it |

The ONLY user step on first run: paste your auto-generated wallet address into [https://faucet.0g.ai](https://faucet.0g.ai) and claim 0.1 0G. After that, sessions auto-mint.

---

## Demo session (the canonical artifact)

**TokenId 0** anchored on BOTH networks — autonomous DeFi swap simulator with a real 0G Compute TeeML inference call:

### Galileo (testnet) — `0xd4a5eA…0E38`

| Seq | Type | What |
|---|---|---|
| 0 | `tool_call` quote | USDC→ETH 1000 → rate 2380.42, ethOut 0.42 |
| 1 | `tool_call` liquidity | Uniswap V3 USDC/WETH 0.3% → depth $1.23M, slippage 0.42% |
| 2 | `tool_call` simulate-swap | slippage=0.5% → executed=true, gas 142k |
| 3 | `tool_call` final-approval | human=`0x3b56...33A3` → approved=false (demo mode) |

All 4 entries TEE-signed. Storage rootHash: `0x53bee8f7174b132fc4e8a85631a41a923a7952117a6e14fdf56fcb1fef6049e6`.

### Aristotle (mainnet) — `0xC6f7fB…8937` (the submission artifact)

| Seq | Type | What |
|---|---|---|
| 0 | `inference` | **REAL 0G Compute TeeML call** to `qwen3.6-plus` model (provider `0x992e6396…`), verifiability `TeeML` |
| 1 | `tool_call` quote | USDC→ETH 1000 → rate 2380.42, ethOut 0.42 |
| 2 | `tool_call` liquidity | Uniswap V3 USDC/WETH 0.3% → depth $1.23M |
| 3 | `tool_call` simulate-swap | slippage=0.5% → executed=true, gas 142k |
| 4 | `tool_call` final-approval | human=`0x3b56...33A3` → approved=false (demo mode) |

All 5 entries signed; on-chain `verifyTEESignature` recovers to the configured oracle. Storage rootHash: `0xecb433f7b311cd5c4313035c156d42df153f0283391af73f4f297758cff3022c`. Mint tx: [`0xd1b14b30…dfb6d152`](https://chainscan.0g.ai/tx/0xd1b14b30894a91e160e35b70e2f834920fe85d0cee8cc24e19f677b4dfb6d152).

Re-mint a fresh session anytime: `pnpm exec tsx scripts/smoke/defi-swap-demo.ts`.

---

## Smoke scripts (live testnet)

```bash
# Mint a fresh DeFi swap demo session (~25-30s):
pnpm exec tsx scripts/smoke/defi-swap-demo.ts

# Resolve a tokenId end-to-end (chain + storage + TEE verify):
pnpm exec tsx scripts/smoke/verify-token.ts <tokenId>

# Per-entry verification (drives the badge-flip animation):
pnpm exec tsx scripts/smoke/per-entry-verify.ts <tokenId>

# Mint a single-entry signed session:
pnpm exec tsx scripts/smoke/signed-anchor.ts
```

---

## Repo layout

```
apps/
  dashboard/              Next.js 14 verifier dashboard
contracts/
  contracts/MockTEEVerifier.sol   verifyTEESignature view function
  scripts/deploy-mock.ts          deploy + persist deployment record
openclaw-skills/
  verifiable-execution/   OpenClaw plugin (register, hooks, wallet, hash)
packages/
  logger/                 SessionLogger + StorageClient (0G Storage)
  tee-adapter/            HeaderParser, signing-message, error classes
  chain-client/           AgenticIDClient + SessionAnchor + retryMint
scripts/
  smoke/                  live testnet smoke tests
context/
  PRD.md, ux-spec.md, architecture.md   spec stack
docs/stories/             14 BDD-shaped implementation stories
```

---

## Status

| Epic | Status |
|---|---|
| Epic 1 — Logger Core | ✅ on main (PR #17) |
| Epic 2 — TEE Adapter | ✅ on main (PR #18) |
| Epic 3 — On-chain Anchor | ✅ on main (PR #19) |
| Epic 4 — OpenClaw Plugin | ✅ on main (PR #20) |
| Epic 5 — Verifier Dashboard | 🟡 PR #21 in review |
| Epic 6 — Zero-config UX + demo polish | 🟡 epic/06-zero-config-ux |
| Design polish (Magic MCP, scamper, frontend skill) | 👤 Abu |

---

## Links

- **Hackathon:** https://www.hackquest.io/hackathons/0G-APAC-Hackathon
- **0G Docs:** https://docs.0g.ai
- **0G Faucet:** https://faucet.0g.ai (Galileo testnet, 0.1 0G/day)
- **0G Galileo Explorer:** https://chainscan-galileo.0g.ai
- **Reference plugin (OpenClaw):** https://github.com/0gfoundation/0g-memory/tree/main/openclaw-skills/evermemos
- **Wallet UX inspiration:** https://github.com/Blockchain-Oracle/xlmtools

---

## Demo script (3 minutes)

See [DEMO.md](./DEMO.md) for the 5-step reverse-arc walkthrough.
