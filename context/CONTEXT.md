# CONTEXT — 0G APAC Hackathon
> **Load this file first.** This is the agent entrypoint for all research on this hackathon.
> Last updated: 2026-04-30 (refreshed — confirmed live, 16 days to deadline)
> Prior run: 2026-04-28

---

## What this hackathon is

The 0G APAC Hackathon is a 2-month builder program (March–May 2026) on HackQuest sponsored by 0G Labs — the team behind the Aristotle Mainnet (live since Sept 2025), a modular AI+Web3 L1 providing decentralized Storage, Compute (AI inference), DA, and Chain primitives. The hackathon has $150,000 in prizes (USDT + 0G Ecosystem Credits) across 5 tracks, with 742+ registered participants. It is designed as developer acquisition for 0G's live mainnet, with follow-up pathways into the Apollo AI Accelerator and AIverse marketplace. The hackathon is APAC-focused but globally open.

**Platform:** HackQuest
**URL:** https://www.hackquest.io/hackathons/0G-APAC-Hackathon
**Sponsor:** 0G Labs (@0G_labs)
**Submission window:** March 18, 2026 → **May 16, 2026, 23:59 UTC+8**
**Days remaining (as of 2026-04-30):** 16 days
**Registered participants (as of 2026-04-30):** 741

---

## Target track

**Track:** Track 1 — Agentic Infrastructure & OpenClaw Lab

**Why this track:** 0G Labs explicitly names OpenClaw as the recommended orchestration framework for Track 1 — the only hackathon in the current field to name Abu's own stack as the preferred framework. Abu's entire infrastructure already runs on OpenClaw. Most other entrants have to learn OpenClaw to compete in Track 1; Abu starts at the finish line.

**Prize:** Part of $100K Grand Prize pool (1st: $45K, 2nd: $35K, 3rd: $20K) + 10 Excellence Awards ($3,700 each)

**Judging criteria (five pillars, no weights published):**
1. 0G Technical Integration Depth & Innovation
2. Technical Implementation & Completeness (requires mainnet contract address + Explorer link)
3. Product Value & Market Potential
4. User Experience & Demo Quality (3-min video)
5. Team Capability & Documentation (README with architecture diagram)

**Hard gate:** At least one 0G component (Storage, Compute, Chain, Agent ID, Privacy/TEE) must be integrated. Projects without 0G integration are explicitly invalid.

---

## Key verified facts

| Field | Value | Source |
|---|---|---|
| Total prize pool | $150,000 USDT + 0G Credits | HackQuest listing (scraped 2026-04-28) |
| Grand prizes | 1st $45K, 2nd $35K, 3rd $20K | HackQuest listing |
| Excellence Awards | 10 × $3,700 | HackQuest listing |
| Community Awards | 10 × $1,300 (community voting) | HackQuest listing |
| Submission deadline | May 16, 2026, 23:59 UTC+8 | HackQuest listing |
| Eligible chains | 0G Mainnet (Aristotle, Chain ID 16661) — mainnet contract required | Submission requirements |
| Required 0G integration | Yes — mainnet contract address + Explorer link (non-negotiable) | Submission requirements |
| Team size | 1–6 members | HackQuest listing |
| Prior work allowed | Yes — existing prototypes permitted if substantially developed during hackathon period | Submission requirements |
| OpenClaw named in Track 1 | Yes — "We encourage the integration of OpenClaw for orchestration" | Track 1 description (verbatim) |
| X post mandatory | Yes — `#0GHackathon #BuildOn0G @0G_labs @0g_CN @0g_Eco @HackQuest_` | Submission requirements |
| Demo video mandatory | Yes — ≤3 min, must show core function + 0G component usage, no slide-only | Submission requirements |
| Registered participants | 742+ | HackQuest listing |
| Reward announcement | May 29, 2026 | HackQuest schedule |

---

## What exists in the field

**Project gallery scraped:** Yes | **Total submissions found:** 11 (partial — gallery shows published entries, not all 742+ registrations) | **Gallery URL:** https://www.hackquest.io/hackathons/0G-APAC-Hackathon (Project Gallery tab)

**IMPORTANT new findings (Apr 28, 2026):**

1. **0G OpenClaw** (gallery submission by Lewis Gao) already implements OpenClaw + 0G Storage (encrypted chat history) + 0G Compute (model inference) as a wallet-bound personal agent. This is the strongest direct competitor in Track 1. It covers the basic "memory + compute" sub-lanes.

2. **`0gfoundation/0g-memory`** (official 0G Foundation repo, 706 commits) is an authoritative OpenClaw persistent memory skill on 0G Storage (`openclaw-skills/evermemos` folder). This is an OFFICIAL product, not a community submission, but it establishes the baseline for what "memory on 0G" looks like.

3. **`0gfoundation/agent-wrapper`** (created TODAY, Apr 28) is 0G's own TEE-wrapped OpenClaw agent lifecycle manager with A2A support. Very new (2 commits) but signals official momentum in the TEE + OpenClaw space.

### Top competitors in target lane

| Project | What it does | Lane overlap | Maturity |
|---|---|---|---|
| 0G OpenClaw | OpenClaw + 0G Storage memory + 0G Compute inference, wallet-bound identity | HIGH | Adapted |
| AgentMart | Agent marketplace with persistent memory via 0G Chain + 0G Storage | MEDIUM | Greenfield |
| 0g-memory (official) | OpenClaw persistent encrypted memory on 0G Storage (NOT a hackathon entry) | HIGH | Startup-grade (706 commits) |
| AgentHub | "AWS for AI agents" agent marketplace (deploys on Base, not 0G — may be disqualified) | HIGH concept, LOW 0G fit | Startup-grade docs |
| Claw_Wallet | Agent wallet with 2-of-3 Shamir recovery via 0G Storage | LOW (different sub-lane) | Adapted |

Full gallery: `03-project-gallery.md`
Detailed competitor analysis: `04-competitor-analysis.md`

---

## Available primitives (what can be built on)

| Primitive | Status | Source |
|---|---|---|
| 0G Storage (TypeScript SDK `@0gfoundation/0g-ts-sdk`) | LIVE | https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk |
| 0G Storage (Go SDK `0gfoundation/0g-storage-client`) | LIVE | https://github.com/0gfoundation/0g-storage-client |
| 0G Compute (`@0glabs/0g-serving-broker`) | LIVE | https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference |
| 0G Private Computer (OpenAI-compatible TEE-sealed inference) | **LIVE (NEW — Apr 28, 2026)** | docs.0g.ai (docs may be in flux) |
| 0G Chain mainnet (Chain ID 16661) | LIVE | https://evmrpc.0g.ai |
| 0G Chain testnet (Galileo) | LIVE | https://evmrpc-testnet.0g.ai |
| iNFT / ERC-7857 contracts | LIVE | https://github.com/0gfoundation/0g-agent-nft |
| Agent ID / ERC-8004 | LIVE (examples) | https://github.com/0gfoundation/agenticID-examples |
| 0G Persistent Memory | COMING SOON (per listing) | 0g-memory repo is pre-release impl |
| .0g Domain (identity) | LIVE | https://0g.ai/blog/introducing-0g-domain |
| agent-wrapper (TEE agent lifecycle) | NEW TODAY (Apr 28) | https://github.com/0gfoundation/agent-wrapper |

Full docs research: `02-sponsor-docs.md`
SDK snippets: `refs/sdk-snippets.md`

---

## Prior winner patterns

**Last hackathon from same sponsor:** Enugu TechFest (0G-sponsored), March 2026 — Ajently won (agent marketplace on 0G Compute + Storage, built in 4 days)

**Winner shape:** Narrow infra wedge + one clearly-demonstrable mechanic + heavy 0G-specific component use. Infra/SDK projects beat consumer apps in ETHGlobal-tier events.

**Winning angle in equivalent track (Track 1-equivalent):**
- Care-AI (ETHGlobal Trifecta): decentralized AI support agent SDK — tool other devs use, narrow, 0G Compute integrated
- OpenMemory (OpenBuild): agent memory transfer system — one primitive, completely done
- Ajently (Enugu): agent marketplace with 0G Storage + Compute — simple chain, clear demo

**Insider check:** No insider/portfolio winner pattern found. Prior winners appear to be external solo devs and small teams.

Full analysis: `05-prior-winners.md`

---

## Hidden-field verdict

| Sub-lane | Verdict | Reasoning |
|---|---|---|
| 0G Private Computer + OpenClaw | GREEN | Launched Apr 28 — zero integrations possible before today; first-mover window is 18 days |
| Verifiable multi-agent audit trail (0G Chain) | GREEN | Not present in any gallery project, prior winner, or community repo |
| iNFT-minted OpenClaw agents (ERC-7857) | GREEN | Only DC Data uses iNFT (different lane); explicitly called for by sponsor |
| OpenClaw + 0G Storage agent memory | YELLOW | Covered by 0G OpenClaw gallery entry + official 0g-memory repo |
| OpenClaw + 0G Compute routing | YELLOW-RED | Covered by community Skill (531 downloads) + 0G OpenClaw gallery entry |
| Agent marketplace on 0G | YELLOW | AgentMart + AgentHub in gallery; Ajently is the prior winner template |
| Generic agent chatbot on 0G | RED | Multiple entries; not differentiated enough to win |

Full analysis: `06-hidden-field.md`

---

## New findings — Apr 30 refresh

**Confirmed fresh:**
- Hackathon is still live with 16 days to deadline (May 16, 2026)
- HackQuest listing confirmed showing 741 registered participants
- HackQuest posted: "entering the last 19 days" — consistent with May 16 close
- 0G Compute Router confirmed: OpenAI/Anthropic-compatible API gateway, handles billing + provider routing automatically. Endpoint: single API key, supports `/v1/chat/completions` with streaming, tool calling, reasoning tokens
- Mainnet confirmed live: Chain ID 16661 (0G Mainnet / Aristotle), RPC `https://evmrpc.0g.ai`
- Testnet confirmed live: Galileo testnet, Chain ID 16602, RPC `https://evmrpc-testnet.0g.ai`, faucet at `https://faucet.0g.ai`
- All official SDKs confirmed live (TypeScript SDK: `npm install @0gfoundation/0g-ts-sdk`, Compute SDK: `npm install @0glabs/0g-serving-broker`)
- 0G Code to Coin (`@0gfoundation/0g-cc`) — an MCP server for Claude Code/Cursor that routes to 0G Compute for inference and 0G Storage for context. Published to npm. New competitor for infra tooling lane.
- **New gallery project found:** "Synapse — Decentralized Memory Layer for AI Agents" — YouTube demo uploaded April 17 (13 days ago). This is a 0G APAC Hackathon 2026 submission specifically in the memory layer space. Direct competition for the YELLOW memory sub-lane.
- **New HackQuest projects page** shows: ShieldAI (autonomous wallet security agent), SovereignVault, ClawWallet, AgentHub, ClawLens (credit score for AI agents). ClawLens is explicitly "credit score for agents based on identity, behavior, and repayment history" — a new Track 3 candidate.

**Submission deadline confirmed:** May 16, 2026

**0G Compute Router confirmed details:**
- Router URL: single unified endpoint, API key auth
- OpenAI / Anthropic compatible API shape
- Automatic provider routing (lowest latency / lowest price)
- On-chain billing: single unified balance
- Best for server-side apps, agents, prototypes

## Open questions (unverified)

- [ ] **Named judge panel for Track 1** — No public judge list found. HackQuest manages logistics; whether 0G technical staff, ecosystem partners, or external judges score is unknown.
- [ ] **Cross-submission permitted?** — Can a project built for ETHGlobal OpenAgents (closes May 3) be extended for APAC (closes May 16)? APAC rules allow prior work if substantially developed during hackathon period — likely yes, but needs verification with HackQuest/0G team.
- [ ] **0G Private Computer exact API** — Launched Apr 28. Check docs.0g.ai/developer-hub/building-on-0g/compute-network for current endpoints and auth flow.
- [ ] **OpenClaw × 0G Labs partnership status** — HackQuest listing and ETHGlobal OpenAgents 0G prize both recommend OpenClaw explicitly. No formal public partnership announcement found. Nature of relationship is unverified.
- [ ] **Per-winner insider audit** — Prior winner names were not individually verified via LinkedIn/GitHub employer checks. No red flags in names, but full audit incomplete.
- [ ] **Live submission count** — HackQuest gallery shows 11+ projects but does not expose total submission count. 741 is registration count, not active builders.
- [ ] **Track per-prize breakdown** — Prize pool appears unified across all tracks ($45K/35K/20K Grand Prize), not split per track. Needs direct confirmation from 0G/HackQuest.
- [ ] **Synapse memory project** — YouTube demo found (https://www.youtube.com/watch?v=DyY_fMI8cko) tagged #0GAPACHackathon2026. Confirms at least one submission in memory sub-lane beyond what gallery shows.

---

---

## Wedge — LOCKED 2026-05-01

**Project: Verifiable Agent Execution**
Track 1 — Agentic Infrastructure & OpenClaw Lab

**What it is:** A primitive that lets anyone prove an AI agent ran exactly what it claimed. Agent executes a task → TEE-sealed proof generated via 0G Private Computer → stored immutably on 0G Storage → iNFT attestation minted → verifiable proof link anyone can check.

**Why this wins:**
- GREEN lane — verifiable audit trail has zero gallery entries
- First mover on 0G Private Computer (launched April 28, zero integrations exist)
- Uses 4 confirmed 0G primitives: Private Computer + iNFT (ERC-7857) + Storage + Chain
- Maxes out the 30% "Technical Integration Depth" judging criterion
- iNFT explicitly called for by sponsor, no implementations built
- OpenClaw as orchestrator = exactly what Track 1 asks for

**First-principles framing:** The real primitive is verifiability, not AI capability. 0G is the only chain where execution provability is built-in (TEE). The rebuilt solution: agent accountability infrastructure.

**SCAMPER verdict:** E + C + M — Eliminate commodity layer (memory/compute routing), Combine the three unique primitives no one has joined (iNFT + Private Computer + Storage), Narrow to one demo loop.

**Pipeline status:**
- [x] scan, research, first-principles, scamper
- [x] Abu wedge approval — 2026-05-01
- [ ] sahil-ui-mining
- [ ] spec-writer → PRD + architecture + stories
- [ ] orchestrator → build

**URGENT: 16 days to deadline (May 16, 2026). Spec-writer must fire immediately.**

---

## File index

| File | Contents |
|---|---|
| `00-overview.md` | One-page hackathon overview: what it is, dates, all links, key sponsor signals |
| `01-prizes-tracks.md` | Full prize breakdown, all 5 tracks with judging criteria and submission requirements |
| `02-sponsor-docs.md` | All 0G SDKs, APIs, repos, testnet status, critical new primitives (Private Computer, agent-wrapper, 0g-memory) |
| `03-project-gallery.md` | All 11 scraped gallery projects with descriptions, stacks, inferred tracks, detailed Track 1 profiles |
| `04-competitor-analysis.md` | Deep read on top 5 Track 1 competitors; updated lane saturation matrix post-gallery |
| `05-prior-winners.md` | Prior 0G-sponsored event winners (13 entries); winner shape patterns; what loses |
| `06-hidden-field.md` | Lane saturation verdict per sub-lane (pre- and post-gallery); ETHGlobal OpenAgents parallel event analysis |
| `07-pre-commit-checklist.md` | All §7 pre-commit checklist answers fully filled; decision: Build |
| `refs/sdk-snippets.md` | Copy-paste SDK code for 0G Storage (Go + TypeScript), 0G Compute, chain config, Private Computer, iNFT |
| `refs/sponsor-repos.md` | All 0gfoundation repos tiered by relevance with clone commands |
| `refs/participant-repos.md` | Gallery participant repos (mostly unlinked); community `in-liberty420/0g-compute` Skill |
