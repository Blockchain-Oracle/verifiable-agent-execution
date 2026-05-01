# 02 — Sponsor Docs: 0G Labs
**Last updated:** 2026-04-30 (refreshed)
**Prior run:** 2026-04-28
**Sources:** docs.0g.ai (scraped), 0gfoundation GitHub org (enumerated)

---

## What 0G Labs builds

0G (Zero Gravity) is the first decentralized AI L1 blockchain — an EVM-compatible Layer 1 with four independently usable infrastructure primitives optimized for AI workloads.

| Component | What it does | Primary SDK/Interface |
|---|---|---|
| **0G Storage** | Decentralized file storage for AI datasets, model weights, agent state, embeddings. Dual-layer: Log (permanent archival) + KV (millisecond query) | Go SDK, TypeScript SDK (`@0gfoundation/0g-ts-sdk`), Python SDK (`0g-storage-sdk`) |
| **0G Compute** | Decentralized AI inference marketplace. Providers run models inside TEE hardware. TeeML (model in TEE) + TeeTLS (proxied through TEE to centralized provider). Supports LLM, text-to-image, speech-to-text | `@0glabs/0g-serving-broker` npm, `0g-compute-cli`, OpenAI-compatible endpoints |
| **0G DA** | Infinitely scalable data availability layer for rollups, AI rollups, gaming chains | For rollup operators — not directly relevant to Track 1 |
| **0G Chain** | Fastest modular EVM L1. Chain ID 16661 (Aristotle Mainnet). Separates consensus from execution. Gas in $0G token | Standard Solidity / Hardhat / Foundry workflows |

### Additional primitives

- **0G Private Computer** (LAUNCHED APR 28, 2026): OpenAI-compatible API where all inference is sealed inside Intel TDX + NVIDIA H100/H200. Even operator cannot read prompts/outputs. 7 models live. **Zero integrations exist yet.**
- **iNFT / ERC-7857**: NFT standard co-developed by 0G for tokenized AI intelligence. Extends ERC-721 with encrypted metadata on 0G Storage, secure re-encryption for ownership transfers. Agents can be minted as iNFTs.
- **0G Persistent Memory** (COMING SOON): Purpose-built for AI agents and long-context LLMs, enabling cross-session "permanent memory." Not yet live per listing. The `0g-memory` repo is the pre-release implementation.
- **.0g Domain**: Native onchain identity/naming. Each .0g name maps to an EVM wallet. Built with SPACE ID.
- **Agent ID / ERC-8004**: On-chain agent registration and identity standard. Maps agents to verifiable on-chain registries.

---

## Live infrastructure status

| Component | Status | Endpoint |
|---|---|---|
| Aristotle Mainnet | LIVE | RPC: `https://evmrpc.0g.ai` / Chain ID: 16661 |
| Galileo Testnet | LIVE | RPC: `https://evmrpc-testnet.0g.ai` |
| Testnet Storage Indexer | LIVE | `https://indexer-storage-testnet-turbo.0g.ai` |
| Mainnet Storage Indexer | LIVE | [see docs.0g.ai for current value] |
| Chain Explorer (mainnet) | LIVE | `https://chainscan.0g.ai` |
| Chain Explorer (testnet) | LIVE | `https://chainscan-galileo.0g.ai` |
| Storage Explorer | LIVE | `https://storagescan-galileo.0g.ai` |
| Faucet | LIVE | `https://faucet.0g.ai` |
| 0G Compute Marketplace | LIVE | `https://compute-marketplace.0g.ai/inference` |
| 0G Private Computer | LIVE (new Apr 28) | OpenAI-compatible endpoint — see docs for API URL |

---

## Compute models available

### Testnet (2 models)

| Model | Type | Input | Output |
|---|---|---|---|
| `qwen-2.5-7b-instruct` | Chatbot | 0.05 0G/1M tokens | 0.10 0G/1M tokens |
| `qwen-image-edit-2511` | Image-Edit | — | 0.005 0G/image |

### Mainnet (7 models)

| Model | Type | Verification | Input | Output |
|---|---|---|---|---|
| `GLM-5-FP8` | Chatbot | TeeML | 1 0G/1M | 3.2 0G/1M |
| `deepseek-chat-v3-0324` | Chatbot | TeeML | 0.30 0G/1M | 1.00 0G/1M |
| `gpt-oss-120b` | Chatbot | TeeML | 0.10 0G/1M | 0.49 0G/1M |
| `qwen3-vl-30b-a3b-instruct` | Chatbot | TeeML | 0.49 0G/1M | 0.49 0G/1M |
| `qwen3.6-plus` | Chatbot (1M ctx) | TeeTLS | 0.80 0G/1M | 4.80 0G/1M |
| `whisper-large-v3` | Speech-to-Text | TeeML | 0.05 0G/1M | 0.11 0G/1M |
| `z-image` | Text-to-Image | TeeML | — | 0.003 0G/image |

---

## Official SDK repos (0gfoundation GitHub org)

| Repo | Description | Language | Last pushed |
|---|---|---|---|
| `0gfoundation/0g-ts-sdk` | TypeScript Storage SDK | TypeScript | Apr 24, 2026 |
| `0gfoundation/0g-storage-client` | Go Storage SDK | Go | Apr 23, 2026 |
| `0gfoundation/0g-serving-broker` | Serving broker SDK | — | Apr 27, 2026 |
| `0gfoundation/0g-storage-ts-starter-kit` | TypeScript storage starter | TypeScript | Apr 25, 2026 |
| `0gfoundation/0g-storage-go-starter-kit` | Go storage starter | Go | — |
| `0gfoundation/0g-memory` | **Official** OpenClaw/Claude Code memory on 0G Storage | Python | Apr 20, 2026 |
| `0gfoundation/agent-wrapper` | TEE-based agent lifecycle for "0G Citizen Claw" | Go | **Apr 28, 2026 (today)** |
| `0gfoundation/0g-agent-skills` | Agent skills library | TypeScript | Feb 20, 2026 |
| `0gfoundation/0g-compute-skills` | Compute skills | — | Feb 20, 2026 |
| `0gfoundation/0g-sandbox` | Billing proxy for 0G Sandbox (wallet-based auth, on-chain settlement) | Go | **Apr 28, 2026 (today)** |
| `0gfoundation/agenticID-examples` | Agent ID examples | — | Apr 4, 2026 |
| `0gfoundation/0g-agent-nft` | Agent NFT contracts (ERC-7857/iNFT) | — | Apr 9, 2026 |
| `0gfoundation/awesome-0g` | Community ecosystem showcase | — | Apr 18, 2026 |

---

## Critical finding: 0g-memory already ships an OpenClaw Skill

`0gfoundation/0g-memory` (https://github.com/0gfoundation/0g-memory) is an **official 0G Foundation product**, not a community project. It:
- Has a `openclaw-skills/evermemos` folder — a ready-to-install OpenClaw Skill
- Also has `opencode-skills/evermemos` for OpenCode
- Also has `claude-skills` folder with Claude Code integration
- 706 commits; last updated April 20, 2026 (active)
- Derived from EverMemOS; gives Claude Code/OpenClaw persistent encrypted memory stored on 0G Storage
- Architecture: 0G KV server for storage backend, with MongoDB/Milvus/ES for local search indexing

**This directly occupies the "0G Storage as OpenClaw agent memory" sub-lane that prior research rated GREEN.** The lane is now YELLOW. The memory primitive is covered. Any submission in this sub-lane must go significantly beyond what `0g-memory` does — e.g., real-time KV state sync, memory-sharing between agents, or tighter OpenClaw native integration.

---

## Critical finding: agent-wrapper is 0G's OpenClaw TEE runtime

`0gfoundation/agent-wrapper` (https://github.com/0gfoundation/agent-wrapper) was created TODAY (Apr 28, 2026). It:
- Runs inside TEE (Trusted Execution Environment) to manage agent lifecycle for "0G Citizen Claw"
- Features: framework-agnostic wrapper, security-critical (handles private keys, TEE attestation), single binary deployment, A2A (agent-to-agent) communication support, OpenClaw framework integration
- Written in Go, 2 commits, 0 stars — very new
- This is 0G's own attempt to create a TEE-wrapped OpenClaw agent runtime

**Impact on hidden-field:** The TEE-wrapped OpenClaw agent sub-lane now has official 0G momentum behind it. A community submission that extends or works alongside `agent-wrapper` (rather than duplicating it) is a stronger wedge.

---

## 0G Compute Router — confirmed Apr 30

The 0G Compute Router is the recommended way to access 0G Compute Network. From docs confirmed Apr 30:
- **URL:** Single unified API endpoint for all 0G inference providers
- **API shape:** OpenAI / Anthropic compatible (`/v1/chat/completions`, streaming, tool calling, reasoning tokens)
- **Authentication:** API key with three permission tiers
- **Billing:** Single unified on-chain balance; automatic deposits and routing
- **Provider routing:** Automatic (lowest latency, lowest price, or pin to specific provider)
- **Best for:** Server-side apps, AI agents, quick prototyping

Router vs Direct comparison:
- Router: single API key, automatic billing, best for agents
- Direct: manual per-provider wallet keys, browser dApps

**npm:** `npm install @0glabs/0g-serving-broker`

---

## 0G Code to Coin (new tool — found Apr 30)

`@0gfoundation/0g-cc` — MCP server published to npm. Bridges 0G decentralized compute and storage to Claude Code / Cursor / Windsurf.
- Decentralized inference routing to 0G Compute Network
- Claims up to 96% cost savings vs centralized providers
- 0G Storage for context, RAG data, model artifacts
- Fine-tuning jobs on 0G Compute Network
- Install in Claude Code: `claude mcp add 0g-cc npx @0gfoundation/0g-cc`

**Relevance to Track 1:** This tool already does "Claude Code + 0G" as an MCP server. Any Track 1 submission that simply wraps 0G compute/storage for Claude Code is now competing with an official 0G Foundation npm package.

---

## 0G-relevant docs pages

| Doc | URL |
|---|---|
| Main docs | https://docs.0g.ai |
| Getting started | https://docs.0g.ai/developer-hub/getting-started |
| Compute Network inference | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference |
| Storage SDK | https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk |
| iNFT / ERC-7857 | https://docs.0g.ai/concepts/inft |
| .0g Domain | https://0g.ai/blog/introducing-0g-domain |
| Testnet overview | https://docs.0g.ai/developer-hub/testnet/testnet-overview |
