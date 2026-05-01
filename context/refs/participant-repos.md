# Participant Repos — 0G APAC Hackathon
**Last updated:** 2026-04-28
**Note:** HackQuest project pages do not always display GitHub repo links visibly (they may require login or appear below the fold). Repo URLs below are those found directly or inferred from project descriptions.

---

## 0G OpenClaw (Lewis Gao) — HIGH relevance to Target Track

**Project page:** https://www.hackquest.io/projects/0G-OpenClaw
**GitHub:** Not directly linked on project page. [UNVERIFIED — no public repo URL found in scrape]
**Tech stack:** Web3, Agent, Node, Rust, TypeScript
**What to look for:**
- How they implemented wallet-bound identity
- 0G Storage encryption for chat history
- 0G Compute inference routing from OpenClaw
- Cross-device memory retrieval mechanism

---

## Claw_Wallet (z c) — MEDIUM relevance

**Project page:** https://www.hackquest.io/projects/Claw_Wallet
**GitHub:** Not directly linked. [UNVERIFIED]
**Tech stack:** React, Solidity, 0g
**What to look for:**
- Shamir Secret Sharing implementation for agent key sharding
- Encrypted share upload to 0G Storage pattern
- On-chain backup registration contract

---

## 0GARGOS (Youvandra Febrial) — LOW relevance to Track 1, HIGH technical depth

**Project page:** https://www.hackquest.io/projects/0GARGOS
**GitHub:** Not directly linked. [UNVERIFIED]
**Tech stack:** React, Web3, Next, Solidity, Ethers, Node, C++, ESP32
**What to look for:**
- 0G DA + Storage + Sealed Inference used together in a single project — most sophisticated multi-primitive integration in gallery
- Physical hardware + on-chain proof architecture
- SRAM PUF entropy generation pattern

---

## Community OpenClaw Skill: in-liberty420/0g-compute

**clawskills.sh:** https://clawskills.sh/skills/in-liberty420-0g-compute
**GitHub:** https://github.com/openclaw/skills/tree/main/skills/in-liberty420/0g-compute
**Version:** 1.0.2 (released March 6, 2026)
**Downloads:** 531 (as of prior research run)
**What it does:** Connects OpenClaw to 0G Compute Network as an inference provider. Handles wallet management, provider discovery, TEE attestation verification. Supports DeepSeek, GLM-5, Qwen models.
**Why relevant:** This is the most-used existing OpenClaw × 0G integration. The basic inference routing lane it owns is YELLOW-RED for competition purposes — Abu should not rebuild this.

---

## AgentMart (Not lazy)

**Project page:** https://www.hackquest.io/projects/AgentMart
**GitHub:** Not displayed. [UNVERIFIED]
**Tech stack:** Python, Solidity
**0G integration claimed:** 0G Chain + 0G Storage for agent memory

---

## AgentHub (Steve Ao)

**Project page:** https://www.hackquest.io/projects/AgentHub-rrMSp8
**GitHub:** Not displayed. [UNVERIFIED]
**Deploy chain:** Base (NOT 0G — potential disqualification)
**Tech stack:** React, Web3, Next, Vue, Rust, Node, Java

---

## DC Data (Martin Yeung)

**Project page:** https://www.hackquest.io/projects/DC-Data
**GitHub:** Not displayed. [UNVERIFIED]
**Tech stack:** Web3, 0g, Vite, Solidity
**0G integration:** iNFT (ERC-7857) + 0G Storage — most sophisticated iNFT use in gallery

---

## EverMemOS (upstream of 0g-memory)

**GitHub:** Not found via search. 0gfoundation/0g-memory says "Derived from EverMemOS." 
**Note:** `0gfoundation/0g-memory` is the 0G-adapted fork with OpenClaw integration. EverMemOS is the upstream.

---

## Notes

- Most gallery projects do not expose public GitHub repos on their HackQuest profile pages. This is a known limitation of HackQuest as a platform — it does not surface GitHub links the way DoraHacks does.
- The most important repo for this research (0G OpenClaw by Lewis Gao) does not have a discoverable GitHub link. If Abu wants to analyze it, he should check the project page directly (logged in) or search GitHub for "0G OpenClaw" / "openclaw 0g compute storage wallet".
