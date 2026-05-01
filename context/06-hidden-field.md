# 06 — Hidden-Field Analysis: 0G APAC Hackathon
**Last updated:** 2026-04-30 (refreshed)
**Prior run:** 2026-04-28
**Track:** Track 1 — Agentic Infrastructure & OpenClaw Lab
**Data sources:** HackQuest gallery (11 projects scraped), 0gfoundation GitHub org (20 repos enumerated), community clawskills.sh, prior research runs

---

## Executive summary

**Apr 30 update:** "Synapse — Decentralized Memory Layer for AI Agents" (https://www.youtube.com/watch?v=DyY_fMI8cko) is a confirmed 0G APAC Hackathon 2026 submission in the memory lane. Demo was posted April 17. This further confirms memory sub-lane is YELLOW.

The original Apr 28 analysis still stands: **0G OpenClaw** is the strongest direct competitor combining OpenClaw + 0G Storage + 0G Compute. **`0gfoundation/0g-memory`** (official product, 706 commits) is the authoritative OpenClaw persistent memory implementation.

These discoveries push basic memory and compute-routing sub-lanes from GREEN to YELLOW. Three lanes remain genuinely open (GREEN): verifiable multi-agent audit trail, iNFT-minted OpenClaw agents, and 0G Private Computer integration (launched Apr 28, zero submissions can include it with meaningful depth).

---

## Sub-lane verdict table

| Sub-lane | Verdict | Evidence | What's needed to win it |
|---|---|---|---|
| **0G Private Computer integration** | GREEN | Launched Apr 28, 2026 — zero gallery entries could include it; no prior OSS integration found | First integration of 0G Private Computer into OpenClaw as a drop-in inference provider; demo shows TEE-sealed inference with no-trust-required proof |
| **On-chain verifiable multi-agent audit trail (0G Chain)** | GREEN | Not present in any gallery project; not in any prior winner; not in any community repo | OpenClaw multi-agent task receipts settled to 0G Chain — each subagent action produces a verifiable tx; demo shows 5 subagents in parallel with live Explorer link |
| **iNFT-minted OpenClaw agents (ERC-7857)** | GREEN | Only DC Data uses iNFT (different track/lane — data marketplace, not agent framework); no OpenClaw × iNFT implementation found | Mint an OpenClaw agent as an iNFT on 0G Chain with encrypted intelligence stored on 0G Storage; agents are tradeable on-chain with royalty splits on usage |
| **OpenClaw + 0G Storage agent memory** | YELLOW | 0G OpenClaw submission covers basic memory. `0gfoundation/0g-memory` (official, 706 commits) is authoritative. **NEW Apr 30:** Synapse project is also explicitly in this lane with a public demo (Apr 17) | Must go meaningfully further: multi-agent shared memory pool, memory-with-retrieval-as-a-service, or real-time agent swarm coordination via shared KV |
| **OpenClaw + 0G Compute (basic routing)** | YELLOW-RED | Community Skill `in-liberty420/0g-compute` v1.0.2 (531 downloads). 0G OpenClaw gallery submission covers it end-to-end | Must differentiate significantly: multi-provider routing with on-chain proof-of-inference receipts, or Private Computer integration |
| **Agent marketplace on 0G** | YELLOW | AgentMart, AgentHub in gallery; Ajently is the prior winner template for this shape | Could win with significantly more 0G integration depth and a narrower, more powerful demo |
| **TEE-wrapped OpenClaw agent lifecycle** | YELLOW | `0gfoundation/agent-wrapper` created Apr 28, 2026 — official 0G product but brand new (2 commits) | Build ON TOP of agent-wrapper as an extension, not a reinvention; add A2A communication or on-chain routing logic |
| **Agent wallet / key management for agents** | YELLOW-RED | Claw_Wallet is a well-executed submission in this lane | Different sub-lane than agent orchestration; skip unless Abu's wedge is explicitly wallet-security |
| **Generic agent chatbot on 0G** | RED | Multiple gallery entries; 0gChat won only $2K in a small event. Not winnable against field | N/A — don't build this |

---

## Detailed lane analysis

### GREEN — 0G Private Computer integration

**Why it's open:** 0G Private Computer (the TEE-sealed OpenAI-compatible inference endpoint) launched today, April 28, 2026. Every submission in the gallery was started before today. No existing gallery project could have integrated this primitive. No community OpenClaw Skill for Private Computer was found on clawskills.sh or GitHub.

**What winning looks like:** An OpenClaw Skill or inference plugin that routes calls through 0G Private Computer. The demo shows: (1) agent makes inference call, (2) response comes back with TEE attestation proof, (3) proof is verifiable on 0G Explorer or via the TEE certificate. Judge psychology: 0G Labs explicitly framed Private Computer as "most AI APIs are a trust exercise — we let you verify it." A submission that embodies this narrative directly gets first-mover credit.

**Risks:** (1) Documentation for Private Computer is fresh — may require exploratory integration work against incomplete docs. (2) This sub-lane could overlap with ETHGlobal OpenAgents entries (due May 3) which might beat Abu to the implementation. (3) By itself, Private Computer integration is thin — needs to be paired with a broader story (agent that uses Private Computer for sensitive reasoning + logs receipts on-chain).

### GREEN — Verifiable multi-agent audit trail (0G Chain)

**Why it's open:** No gallery project implements this. No prior 0G winner ever built this. The concept: when OpenClaw spawns subagents (the existing `sessions_spawn` / multi-agent routing), each subagent's task receipt — model used, inputs hashed, outputs hashed, cost, duration — gets settled to 0G Chain as a micro-transaction. A "git log for agent runs" that's tamper-evident and queryable on the public explorer.

**What winning looks like:** Spawn 5 subagents in parallel, show a public 0G Explorer link listing every agent action with cryptographic linkage. Judge sees a live Explorer page with real transactions. Demo is immediately legible.

**Risks:** (1) Engineering complexity — requires a new OpenClaw module that intercepts session events and writes them to 0G Chain. Needs a deployed smart contract. (2) Gas costs for per-action on-chain writes — may require batching. (3) 18 days is tight but viable for a narrow implementation.

### GREEN — iNFT-minted OpenClaw agents (ERC-7857)

**Why it's open:** DC Data uses iNFT for a data marketplace (different track, different purpose). No project has minted an OpenClaw agent as an iNFT. The ETHGlobal OpenAgents 0G prize explicitly calls this out as desired: "iNFT-minted agents with embedded intelligence (encrypted on 0G Storage), persistent memory, dynamic upgrades, and automatic royalty splits on usage."

**What winning looks like:** Deploy a smart contract that mints an OpenClaw agent as an ERC-7857 iNFT. The agent's system prompt / skills / memory are encrypted and stored on 0G Storage. Ownership is on-chain. When another user "hires" the agent (invokes it), a micro-payment flows via the NFT contract, and the agent responds using the encrypted intelligence retrieved via the owner's 0G key.

**Risks:** (1) ERC-7857 is a new standard — documentation may be sparse. `0gfoundation/0g-agent-nft` repo exists (Apr 9, 2026) as reference. (2) Building a full marketplace UI is out of scope for 18 days — the demo only needs to show minting + one-agent invocation with on-chain proof. (3) This lane is called out by both the APAC listing and ETHGlobal OpenAgents — which means it's also being built by ETHGlobal participants (May 3 deadline). Those builds will be public before the APAC deadline.

### YELLOW — OpenClaw + 0G Storage agent memory

**Why it's not green anymore:** `0gfoundation/0g-memory` is an official product with `openclaw-skills/evermemos` folder, 706 commits, and active development. The 0G OpenClaw gallery submission also implements basic memory-on-storage. The "add 0G Storage memory to OpenClaw" lane is covered.

**What winning would require:** Multi-agent shared memory pool (multiple OpenClaw instances sharing a single 0G KV store for collective memory, coordinated via a smart contract), or memory-as-a-service with on-chain payment gating (other agents/users pay to read from your memory store), or KV + Log hybrid for real-time streaming agent state.

---

## What the ETHGlobal OpenAgents parallel event means

ETHGlobal OpenAgents (Apr 24–May 6) is running simultaneously with 0G as a $15K sponsor. This event explicitly asks for OpenClaw × 0G integrations. The OpenAgents submissions will be public by May 6 — 10 days before the APAC deadline.

**Implication:** By the time May 6 arrives, the best OpenClaw × 0G basic integrations will be visible as prior art. The APAC submission (due May 16) needs to be deeper, more documented, and more 0G-native than what ETHGlobal produces. The APAC format (mainnet contract, verifiable Explorer link, 3-min video, architecture README) rewards depth over breadth.

**Opportunity:** A submission that starts at the ETHGlobal OpenAgents event (builds May 3 for OpenAgents) and then extends it significantly for APAC (adds mainnet deploy + more documentation + deeper 0G integration in the 10 remaining days) could stack both prizes [NEEDS VERIFICATION with HackQuest/0G team].

---

## Overall hidden-field verdict

**Track 1 — Agentic Infrastructure & OpenClaw Lab: GREEN** with sub-lane refinements.

The three open GREEN sub-lanes (Private Computer, multi-agent audit trail, iNFT) are each independently winnable with a sharp, narrow build in 18 days. The yellow sub-lanes (memory, compute routing) can still win with significant differentiation from existing implementations.

The field as visible in the gallery is not startup-grade-dominant. The strongest competitor (0G OpenClaw) is solid but narrow and does not own any of the three GREEN lanes.
