# Sponsor Repos — 0G APAC Hackathon
**Last updated:** 2026-04-30 (refreshed)
**Prior run:** 2026-04-28
**Source:** github.com/0gfoundation (enumerated 2026-04-28)

---

## Tier 1 — Critical for Track 1 (read/use these)

### 0g-memory
**Repo:** https://github.com/0gfoundation/0g-memory
**Description:** Official 0G Foundation product — Claude Code / OpenClaw persistent encrypted memory stored on 0G decentralized network. Derived from EverMemOS.
**Language:** Python
**Last pushed:** Apr 20, 2026
**Commits:** 706
**Stars:** 0 (internal/official — not a community contribution)
**Key folders:**
- `openclaw-skills/evermemos` — OpenClaw Skill for persistent memory
- `opencode-skills/evermemos` — OpenCode equivalent
- `claude-skills` — Claude Code direct integration
- `0g_kv_server` — 0G KV storage backend
**Clone:**
```bash
git clone https://github.com/0gfoundation/0g-memory
```
**Why relevant:** The authoritative implementation of memory-on-0G for OpenClaw. Read this before building anything in the memory sub-lane.

---

### agent-wrapper
**Repo:** https://github.com/0gfoundation/agent-wrapper
**Description:** TEE-based agent lifecycle management for "0G Citizen Claw" with OpenClaw framework integration.
**Language:** Go
**Last pushed:** Apr 28, 2026 (TODAY)
**Commits:** 2
**Stars:** 0
**Features (per initial commit message):**
- Framework-agnostic agent wrapper
- Security-critical (handles private keys, TEE attestation)
- Self-contained single binary deployment
- Dashboard endpoint with real-time log buffering
- A2A (agent-to-agent) communication support
- OpenClaw framework integration
**Clone:**
```bash
git clone https://github.com/0gfoundation/agent-wrapper
```
**Why relevant:** 0G's own TEE-wrapped OpenClaw runtime, created today. Building on top of this (rather than reinventing it) is a stronger judging position.

---

### 0g-sandbox
**Repo:** https://github.com/0gfoundation/0g-sandbox
**Description:** Billing proxy for 0G Sandbox — wallet-based auth, per-minute billing, on-chain settlement.
**Language:** Go
**Last pushed:** Apr 28, 2026 (TODAY)
**Commits:** 104
**Stars:** 1
**Key feature:** Contains `.claude-plugin` folder and `.claude/skills` — this is the 0G Sandbox product with OpenClaw integration baked in. The billing/on-chain settlement mechanism is live.
**Clone:**
```bash
git clone https://github.com/0gfoundation/0g-sandbox
```
**Why relevant:** Shows how 0G handles wallet-based billing for sandbox environments — relevant if building anything with agent payment rails.

---

## Tier 2 — SDKs and starter kits (reference for integration)

### 0g-ts-sdk (TypeScript Storage SDK)
**Repo:** https://github.com/0gfoundation/0g-ts-sdk
**Language:** TypeScript
**Last pushed:** Apr 24, 2026
**Install:** `npm install @0gfoundation/0g-storage-ts-sdk ethers` (historic `@0gfoundation/0g-ts-sdk` is npm-deprecated — every version redirects to the new name)
**Use for:** File storage/retrieval, KV store operations, browser support

### 0g-storage-client (Go Storage SDK)
**Repo:** https://github.com/0gfoundation/0g-storage-client
**Language:** Go
**Last pushed:** Apr 23, 2026
**Install:** `go get github.com/0gfoundation/0g-storage-client`
**Use for:** Backend Go services, file upload/download, Merkle proof verification

### 0g-storage-ts-starter-kit
**Repo:** https://github.com/0gfoundation/0g-storage-ts-starter-kit
**Language:** TypeScript
**Last pushed:** Apr 25, 2026
**Clone and run:**
```bash
git clone https://github.com/0gfoundation/0g-storage-ts-starter-kit
cd 0g-storage-ts-starter-kit && npm install
cp .env.example .env
npm run upload -- ./file.txt
```

### 0g-storage-go-starter-kit
**Repo:** https://github.com/0gfoundation/0g-storage-go-starter-kit
**Language:** Go

### 0g-serving-broker (Compute Serving Broker)
**Repo:** https://github.com/0gfoundation/0g-serving-broker
**Last pushed:** Apr 27, 2026
**Install:** `npm install @0gfoundation/0g-compute-ts-sdk` (historic `@0glabs/0g-serving-broker` is a deprecated re-export shim per npm registry — do not use for new code)
**Use for:** On-chain payment routing for 0G Compute inference requests

### 0g-serving-user-broker
**Repo:** https://github.com/0gfoundation/0g-serving-user-broker
**Description:** User broker SDK for 0G Serving System
**Last pushed:** Apr 21, 2026

### 0g-cc (0G Code to Coin — found Apr 30)
**npm:** `npx @0gfoundation/0g-cc`
**Published to npm as:** `@0gfoundation/0g-cc`
**Description:** MCP server bridging 0G Compute + Storage to Claude Code / Cursor / Windsurf
**Features:** Decentralized inference routing, up to 96% cost savings, 0G Storage for context, fine-tuning, VIBEZ token integration (coming soon)
**Relevance:** This is an official 0G MCP tool. Any submission that simply wraps 0G compute for Claude Code is now competing with this published product. Track 1 submissions should go beyond what 0g-cc does.

---

## Tier 3 — Contracts and standards (reference)

### 0g-agent-nft (ERC-7857 iNFT contracts)
**Repo:** https://github.com/0gfoundation/0g-agent-nft
**Last pushed:** Apr 9, 2026
**Use for:** iNFT minting contracts, ERC-7857 implementation reference

### agenticID-examples (Agent ID / ERC-8004)
**Repo:** https://github.com/0gfoundation/agenticID-examples
**Last pushed:** Apr 4, 2026
**Use for:** Agent ID registration and identity examples

### 0g-agent-skills
**Repo:** https://github.com/0gfoundation/0g-agent-skills
**Language:** TypeScript
**Stars:** 13
**Last pushed:** Feb 20, 2026
**Use for:** Official agent skill patterns from 0G Foundation

### 0g-compute-skills
**Repo:** https://github.com/0gfoundation/0g-compute-skills
**Stars:** 17
**Last pushed:** Feb 20, 2026

### 0g-restaking-contracts
**Repo:** https://github.com/0gfoundation/0g-restaking-contracts
**Last pushed:** Apr 9, 2026

---

## Tier 4 — Discovery / curation

### awesome-0g
**Repo:** https://github.com/0gfoundation/awesome-0g
**Description:** Curated showcase of 0G community and ecosystem projects
**Last pushed:** Apr 18, 2026
**Use for:** Finding ecosystem projects, partner integrations, prior art

### 0g-doc
**Repo:** https://github.com/0gfoundation/0g-doc
**Description:** 0G Documentation
**Last pushed:** Apr 27, 2026
