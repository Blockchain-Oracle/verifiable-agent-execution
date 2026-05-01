# 04 — Competitor Analysis: 0G APAC Hackathon
**Last updated:** 2026-04-28
**Focus:** Track 1 — Agentic Infrastructure & OpenClaw Lab

---

## Summary verdict

The gallery (11 projects) shows a field of **early-to-mid maturity** across Track 1. The most serious direct competitor is **0G OpenClaw** — it already combines OpenClaw + 0G Storage + 0G Compute in a working implementation. This partially covers Wedge #1 (OpenClaw Compute) and Wedge #2 (OpenClaw Storage Memory) from prior research. However, critical lanes remain open:

- No project uses 0G Private Computer (launched Apr 28 — zero submissions could include it)
- No project implements a verifiable multi-agent audit trail on 0G Chain
- No project implements iNFT-minted OpenClaw agents (ERC-7857)
- The `agent-wrapper` and `0g-memory` repos are OFFICIAL 0G products, not community submissions — their existence narrows the memory sub-lane but opens flanking angles (extending official 0G primitives in new directions)

---

## Competitor profiles (Track 1 relevant)

### 1. 0G OpenClaw [HIGH overlap]

| Field | Details |
|---|---|
| **URL** | https://www.hackquest.io/projects/0G-OpenClaw |
| **Builder** | Lewis Gao |
| **One-liner** | "Your key. Your agent." — OpenClaw instance wallet-bound to a 0G wallet; chat history on 0G Storage, inference via 0G Compute Market |
| **0G components used** | 0G Storage (encrypted chat history) + 0G Compute Network (model inference) |
| **Tech stack** | Web3, Agent, Node, Rust, TypeScript |
| **Deploy chain** | 0G |
| **Demo maturity** | Has demo video (mp4). Has screenshot. |
| **What it does well** | End-to-end: installs OpenClaw, funds wallet with $0G, imports wallet, pulls chat history from 0G Storage, runs inference on 0G Compute. Cross-device portability is the demo hook. |
| **What it does NOT do** | No on-chain verifiable agent audit trail. No iNFT. No multi-agent orchestration. No 0G Private Computer (pre-dates Apr 28). No A2A communication. |
| **Lane overlap with Abu** | Very high for basic OpenClaw + 0G Storage + Compute routing. |
| **Maturity signal** | Adapted/startup-grade — full working implementation with demo |
| **Risk to Abu** | HIGH if Abu's wedge is "OpenClaw with 0G memory + compute." Must go significantly further — e.g., Private Computer integration, verifiable audit trail, or multi-agent coordination. |

### 2. AgentMem [MEDIUM overlap, weak submission]

| Field | Details |
|---|---|
| **URL** | https://www.hackquest.io/projects/AgentMem |
| **Builder** | zhang tutu |
| **One-liner** | "Decentralized Knowledge Infrastructure for Autonomous Agents" |
| **0G components used** | Unknown — description is thin |
| **Deploy chain** | Arbitrum One (NOT 0G mainnet — potential disqualification) |
| **Demo maturity** | No demo video, no images, description is just the tagline repeated |
| **Risk to Abu** | LOW — likely a placeholder submission or very early stage. Deploy chain (Arbitrum) may disqualify it |

### 3. Claw_Wallet [LOW-MEDIUM overlap, strong build]

| Field | Details |
|---|---|
| **URL** | https://www.hackquest.io/projects/Claw_Wallet |
| **Builder** | z c |
| **One-liner** | Crypto wallet for AI Agents with 2-of-3 Shamir shard recovery backed by 0G Storage |
| **0G components used** | 0G Storage (encrypted shard upload), 0G Chain (on-chain backup registration) |
| **Deploy chain** | 0G |
| **Progress** | Contract deployed, backup flow working, encrypted shard upload to 0G Storage done. Recovery pipeline in progress. |
| **Lane overlap with Abu** | Low — "wallet recovery for agents" is adjacent to agent infra but not the same lane as agent orchestration framework. No 0G Compute. |
| **Maturity signal** | Adapted — working implementation with real 0G Storage integration |
| **Risk to Abu** | LOW — different sub-lane (agent wallet security vs agent orchestration/skills) |

### 4. AgentHub [HIGH concept overlap, wrong chain]

| Field | Details |
|---|---|
| **URL** | https://www.hackquest.io/projects/AgentHub-rrMSp8 |
| **Builder** | Steve Ao |
| **One-liner** | "AWS for AI agents" — secure execution platform + marketplace for third-party specialist agents |
| **0G components used** | Not clearly stated — description focuses on the platform, not 0G-specific integration |
| **Deploy chain** | Base (NOT 0G mainnet — likely disqualified under 0G integration requirement) |
| **Demo maturity** | YouTube demo video, project images, detailed business case documentation |
| **Lane overlap with Abu** | High on concept ("agent execution infrastructure") but the wrong-chain deploy severely limits judging viability |
| **Maturity signal** | Startup-grade business documentation; unclear technical implementation |
| **Risk to Abu** | MEDIUM-LOW — if disqualified due to deploy chain, not a threat. If allowed in, it occupies a broader lane than a narrow OpenClaw-specific wedge |

### 5. AgentMart [MEDIUM overlap]

| Field | Details |
|---|---|
| **URL** | https://www.hackquest.io/projects/AgentMart |
| **Builder** | Not lazy |
| **One-liner** | Decentralized marketplace for autonomous AI agents with persistent long-term memory via 0G Storage |
| **0G components used** | 0G Chain + 0G Storage (for agent memory) |
| **Deploy chain** | Not explicitly listed |
| **Demo maturity** | Has demo video (webm). Simple 5-step description. |
| **Lane overlap with Abu** | Medium — the "agent marketplace with 0G memory" concept is similar to the Ajently prior winner. Covers the basic agent-hire-with-memory loop. |
| **Maturity signal** | Greenfield — simple implementation, limited description |
| **Risk to Abu** | MEDIUM — occupies the "agents can have persistent memory" slot. If Abu's wedge is memory-focused, this is competition. |

---

## Official 0G competition (not community submissions — harder to beat directly)

### 0gfoundation/0g-memory
- **What it is:** Official 0G Foundation product — Claude Code / OpenClaw persistent encrypted memory on 0G Storage
- **OpenClaw integration:** Has `openclaw-skills/evermemos` skill folder
- **Maturity:** 706 commits, last updated Apr 20, 2026. Active development.
- **Impact:** This is the authoritative implementation of "0G Storage as OpenClaw agent memory." Any hackathon submission in this sub-lane will be compared against this. The lane is **YELLOW** (not dead — the official product is not a hackathon entry — but a submission must add clear value beyond what the official product provides).
- **Angle to differentiate:** Multi-agent shared memory (not single-agent), real-time KV sync across agent swarms, or memory-with-retrieval as a service with on-chain payment gating.

### 0gfoundation/agent-wrapper
- **What it is:** TEE-based agent lifecycle management for "0G Citizen Claw" with OpenClaw integration — created TODAY (Apr 28)
- **Maturity:** 2 commits, 0 stars, brand new
- **Impact:** 0G is building its own TEE-wrapped OpenClaw runtime. The `agent-wrapper` repo signals that "TEE + OpenClaw lifecycle" is something 0G Labs is doing in-house. A submission that extends `agent-wrapper` or builds on top of it is more sponsor-aligned than one that reinvents the same thing.

---

## Lane saturation matrix (updated with gallery data)

| Sub-lane | Pre-gallery verdict | Post-gallery verdict | Reason for change |
|---|---|---|---|
| OpenClaw + 0G Compute (basic routing) | YELLOW | YELLOW-RED | 0G OpenClaw project covers this end-to-end |
| OpenClaw + 0G Storage (agent memory) | GREEN | YELLOW | 0G OpenClaw covers basic; 0g-memory is official product |
| Verifiable multi-agent audit trail (0G Chain) | GREEN | GREEN | Not present in any gallery project |
| iNFT-minted OpenClaw agents (ERC-7857) | GREEN | GREEN | Only DC Data uses iNFT, different lane/track |
| 0G Private Computer integration | GREEN | GREEN | Launched today; zero gallery projects can include it |
| Agent wallet for autonomous agents | RED | RED (different lane) | Claw_Wallet owns this; not Abu's target lane |
| Agent marketplace | YELLOW | YELLOW | AgentMart + AgentHub both present; Ajently prior winner shape |
| Generic agent chatbot on 0G | RED | RED | Multiple entries; low differentiation |
