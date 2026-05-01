# Verifiable Agent Execution

> Prove your AI agent ran exactly what it claimed — cryptographic receipts for every session.

**Hackathon:** 0G APAC Hackathon 2026 — Track 1 (Agentic Infrastructure & OpenClaw Lab)  
**Deadline:** May 16, 2026  
**Prize pool:** $150K USDT | Grand Prize: $45K / $35K / $20K

---

## What it is

AI agents are increasingly trusted to act autonomously — but today there is no way to prove what an agent actually did. Anyone can claim an agent ran a task correctly; no one can verify it.

**Verifiable Agent Execution** closes this gap: every OpenClaw agent session produces a cryptographically signed, immutably stored, on-chain-anchored proof that anyone can independently verify. The proof chain runs:

```
Tool call → TEE signature (0G Private Computer) → 0G Storage hash → iNFT attestation (ERC-7857)
```

Share one link. Anyone can verify the agent did exactly what it claimed.

---

## 0G Primitives integrated

| Primitive | Role |
|---|---|
| 0G Private Computer (TEE) | Signs agent inference responses — proves what the model actually output |
| 0G Storage | Immutable session log — stores the full execution trace |
| 0G Chain / AgenticID (ERC-8004) | On-chain anchor — ties sessions to a verifiable agent identity |
| iNFT / ERC-7857 | Proof attestation — mints a non-transferable receipt per session |

---

## Repo structure

```
research/          # Full hackathon research, competitor analysis, SDK docs
docs/              # PRD, architecture, epics, UX spec, UI mining, sprint status
docs/stories/      # 14 implementation stories (decomposed by epic)
refs/              # SDK snippets, sponsor repos, participant repos
src/               # Source code (coming)
```

---

## Demo moment (judge walkthrough)

1. Run any OpenClaw agent task
2. Agent executes under TEE — Private Computer signs the response
3. Session log sealed and pinned to 0G Storage — returns a CID
4. iNFT minted on 0G Chain — ties CID + TEE signature to AgenticID
5. Share the proof link — anyone opens it, sees the full verifiable audit trail

Total demo time: ~90 seconds.

---

## Links

- Hackathon: https://www.hackquest.io/hackathons/0G-APAC-Hackathon
- 0G Docs: https://docs.0g.ai
- 0G Chain (Aristotle Mainnet): Chain ID 16661, RPC https://evmrpc.0g.ai
