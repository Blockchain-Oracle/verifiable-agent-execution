# 07 — Pre-Commit Checklist: 0G APAC Hackathon
> Answers to hackathon-playbook.md §7.
> Last updated: 2026-04-28

---

## Theme and rules

- **What is the exact theme?**
  Track 1: Agentic Infrastructure & OpenClaw Lab. Core focus: developing the cognitive backbone and orchestration layers for autonomous intelligence. Technical scope: building agent frameworks, specialized Skills, and data-processing pipelines. Priority stack: OpenClaw for orchestration + 0G Compute (inference) + 0G Storage (state persistence and long-context memory).

- **Are prior components or old repos allowed?**
  Yes. Verbatim from rules: "Teams may submit a brand-new project, an early MVP, or an existing prototype that is further developed and deployed on 0G during the hackathon." Requirement is *substantial development progress during the hackathon period*. Abu can build on existing OpenClaw infrastructure as long as the 0G integration is new work with real commits.

- **Are forks / adaptations culturally normal here?**
  Yes. The ETHGlobal OpenAgents 0G prize (parallel event, same sponsor) explicitly says: "Build the best core extensions, improvements, forks, or entirely new open agent frameworks inspired by OpenClaw." Extending official 0G repos (`0g-memory`, `agent-wrapper`) is explicitly invited.

- **What are the explicit judging criteria?**
  Five pillars (no numerical weights published — [UNVERIFIED]):
  1. 0G Technical Integration Depth & Innovation
  2. Technical Implementation & Completeness (includes mandatory on-chain deploy — Explorer link + contract address)
  3. Product Value & Market Potential
  4. User Experience & Demo Quality (3-min video)
  5. Team Capability & Documentation (README with architecture diagram)
  Hard rule: at least one 0G component must be integrated. Failure = disqualification or major score deductions.

- **Is there a required sponsor integration?**
  Yes. Must integrate at least one of: 0G Storage, 0G Compute, 0G Chain, Agent ID, Privacy/TEE features. Must submit a 0G mainnet contract address + 0G Explorer link proving on-chain activity. Track 1 specifically encourages OpenClaw + 0G Compute + 0G Storage.

- **Can you win without using the sponsor's product?**
  No. Projects without actual 0G integration are explicitly invalid.

---

## Field intelligence

- **What are the top 5 adjacent winners from similar events?**
  1. **AInfluencer** (ETHGlobal Cannes 2025, 0G track) — Autonomous AI YouTuber using 0G Compute + ZK proofs. Narrow + visceral demo + fully 0G-native. Won because: single clear mechanic + sponsor-native + demo judges could see in 15 seconds.
  2. **Care-AI** (ETHGlobal Trifecta 2025, 0G track) — Decentralized AI support agent SDK. Infra/SDK wedge, narrow and reusable. Won because: tools other devs use beat consumer apps.
  3. **OpenMemory** (OpenBuild Shenzhen) — Agent memory transfer system. Narrow infra primitive with clear story. Won because: solved one clearly-articulated problem completely.
  4. **Ajently** (Enugu TechFest, Mar 2026) — Unified AI agent marketplace on 0G Compute + Storage. Most recent winner template. Won because: clear one-liner, strong 0G integration, built in 4 days.
  5. **Clampify.fun** (ETHGlobal Trifecta 2025, 0G track) — Rugproof meme launches via TEE. One narrow primitive, TEE-native. Won because: solved a real problem in one mechanic with verifiable on-chain proof.

- **Are there any Cards402-type incumbents already in the lane?**
  The closest incumbent is `0G OpenClaw` (gallery submission) — OpenClaw + 0G Storage + 0G Compute integration. Not startup-grade but a working implementation. Also `0gfoundation/0g-memory` — official 0G product with OpenClaw memory skill (706 commits). Neither occupies the Private Computer, multi-agent audit trail, or iNFT sub-lanes.

- **Are there obscure repos that already own the obvious angle?**
  - `in-liberty420/0g-compute` OpenClaw Skill on clawskills.sh — v1.0.2, 531 downloads. Covers basic 0G Compute routing. Source: https://clawskills.sh/skills/in-liberty420-0g-compute
  - `0gfoundation/0g-memory` (official) — `openclaw-skills/evermemos` folder. Covers persistent memory on 0G Storage. Source: https://github.com/0gfoundation/0g-memory
  - `0G OpenClaw` gallery submission (Lewis Gao) — combines both of the above into a wallet-bound OpenClaw experience. Source: https://www.hackquest.io/projects/0G-OpenClaw

- **Is the lane green / yellow / red?**
  - 0G Private Computer + OpenClaw: **GREEN** — zero prior art, launched today
  - Verifiable multi-agent audit trail on 0G Chain: **GREEN** — not in any gallery, prior winner, or repo
  - iNFT-minted OpenClaw agents (ERC-7857): **GREEN** — not in gallery, explicitly called for by sponsor
  - OpenClaw + 0G Storage memory: **YELLOW** — covered by 0g-memory (official) and 0G OpenClaw gallery entry
  - OpenClaw + 0G Compute routing: **YELLOW-RED** — covered by community Skill + 0G OpenClaw gallery entry
  - Generic agent platform: **RED** — multiple gallery entries, low differentiation

---

## Idea quality (fill after wedge is proposed)

- **Can the idea be explained in one line?**
  Must be ≤30 words — this is the literal submission requirement. Template for Track 1 green lanes:
  - Private Computer: "An OpenClaw Skill that routes agent inference through 0G Private Computer TEE-sealed compute — every inference call comes with a tamper-evident cryptographic receipt."
  - Audit trail: "Every OpenClaw multi-agent task produces a verifiable receipt settled on 0G Chain — a clickable Explorer link proves what ran, when, and at what cost."
  - iNFT: "Mint any OpenClaw agent as an ERC-7857 iNFT — encrypted skills + memory stored on 0G Storage, tradeable on-chain, with automatic royalty splits on each invocation."

- **Does it map directly to sponsor value?**
  Yes for all three GREEN lanes:
  - Private Computer: directly demonstrates 0G's core thesis ("verify, don't trust AI inference")
  - Audit trail: hits 0G Chain (mandatory) + multi-agent orchestration (Track 1 focus)
  - iNFT: explicitly called for in ETHGlobal OpenAgents 0G prize criteria + uses ERC-7857 which 0G co-developed

- **Is it narrower than Abu's natural tendency?**
  Must be enforced. Abu's tendency = build platforms. The winning shape = one primitive, one hero loop, one demo moment. Pick one of the three GREEN lanes and go deep, not all three.

- **Would a tired judge understand it in 15 seconds?**
  Yes, for the audit trail and Private Computer lanes. Demo moment:
  - Audit trail: "I spawn 5 OpenClaw subagents, here's the live 0G Explorer page showing every task cryptographically linked" — judge clicks link, sees real txs.
  - Private Computer: "I ask a sensitive question, here's the TEE attestation proof that even 0G couldn't read my prompt" — judge sees the receipt.

- **Is there a stronger existing version already visible?**
  - For basic compute routing: yes (`in-liberty420/0g-compute` + 0G OpenClaw gallery entry)
  - For basic memory: yes (`0g-memory` official product)
  - For audit trail, Private Computer, iNFT: no — no stronger existing version found

---

## Decision

- [x] **Build — target lane is clear, no dominant incumbent, sponsor fit is strong**

Track 1 is the build track. The specific sub-lane (among the three GREEN options) is Abu's call. Research scope ends here; wedge decision is Abu's domain.

The decision frame:
- Pick the sub-lane where Abu's existing OpenClaw skill/infrastructure gives the most leverage
- Build one narrow primitive with one demo moment
- Do not merge wedges
