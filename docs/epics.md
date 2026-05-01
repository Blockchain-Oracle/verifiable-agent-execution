# Epics — Verifiable Agent Execution
**Project:** Verifiable Agent Execution  
**Updated:** 2026-05-01

---

## Epic dependency order

```
Epic 1 ──────────────────────────────────────────► Epic 3
  │                                                    │
  │        Epic 2 ──────────────────────────────────► Epic 5 ► Epic 6
  │          │                                         ▲
  └──────────┼─────────────────────► Epic 4 ───────────┘
             │                         ▲
             └─────────────────────────┘
```

Run Epic 1 and Epic 2 in parallel (no cross-dependency). Epic 3 needs Epic 1. Epic 4 needs Epic 1 + Epic 2. Epic 5 needs Epic 3 + Epic 4. Epic 6 is final polish.

---

## Epic 1 — Execution Logger Core

**Business value:** The core primitive — captures every tool call in a session, signs it, and flushes an immutable log to 0G Storage. Without this, there's nothing to prove.

**Dependencies:** None

**Stories:**
1. `story-log-schema` — Define ExecutionLogEntry + SessionLog TypeScript types with Zod validation (~1h)
2. `story-storage-client` — 0G Storage upload wrapper: Buffer → bytes32 root hash (~1.5h)
3. `story-session-logger` — SessionLogger class: accumulate entries + flush via StorageClient (~2h)

**Estimated coding-agent time:** ~4.5h total across 3 stories (parallelizable: story-log-schema and story-storage-client have no interdependency)

---

## Epic 2 — TEE Proof Adapter

**Business value:** Extracts the cryptographic TEE signature from 0G Private Computer responses and validates it against the TEEVerifier contract — the "proof" layer that makes the audit trail cryptographically trusted.

**Dependencies:** None (can run in parallel with Epic 1)

**Stories:**
4. `story-tee-header-parser` — Parse ZG-Res-Key header → {text, signature, signingAddress} (~1h)
5. `story-tee-verifier-contract` — Compile + deploy MockTEEVerifier.sol on Galileo testnet (~1.5h)
6. `story-tee-proof-flow` — TEEProofAdapter: keccak256(text) + verifyTEESignature(hash, sig) (~1.5h)

**Estimated coding-agent time:** ~4h total across 3 stories (story-tee-header-parser and story-tee-verifier-contract can run in parallel)

---

## Epic 3 — On-chain Anchor

**Business value:** Mints an iNFT (ERC-7857 AgenticID) for each completed session, permanently linking the agent identity to the session log hash on 0G Chain.

**Dependencies:** Epic 1 (needs SessionLogger.flush() → rootHash)

**Stories:**
7. `story-agenticid-client` — ethers.js wrapper for AgenticID iMint() + getIntelligentDatas() (~1.5h)
8. `story-session-mint` — SessionAnchor: flush → iMint({description, dataHash}) → return verifyUrl (~1.5h)

**Estimated coding-agent time:** ~3h total (story-agenticid-client has no internal dep so can start immediately; story-session-mint follows)

---

## Epic 4 — OpenClaw Skill

**Business value:** Plugs the logger into OpenClaw's session lifecycle with zero agent-wrapper modification. Any OpenClaw session with the skill installed auto-produces a proof at session end.

**Dependencies:** Epic 1 (SessionLogger types), Epic 2 (TEE header parsing for tool call entries)

**Stories:**
9. `story-skill-init` — OpenClaw skill entrypoint + SKILL.md + session lifecycle hook stubs (~1h)
10. `story-skill-intercept` — onToolCall hook: parse headers, append ExecutionLogEntry to SessionLogger (~1.5h)
11. `story-skill-close` — onSessionEnd: trigger flush + anchor, emit verifyUrl in session output (~1.5h)

**Estimated coding-agent time:** ~4h (story-skill-init can start in parallel with Epic 1/2; stories 10 and 11 follow sequentially)

---

## Epic 5 — Verification Dashboard

**Business value:** The demo surface — a public URL where anyone can inspect the proof chain for any anchored session. Makes the primitive tangible for judges without requiring a wallet.

**Dependencies:** Epic 3 (SessionAnchor.anchor() → tokenId) + Epic 4 (skill produces the verifyUrl)

**Stories:**
12. `story-verifier-api` — Next.js API route: GET /api/verify/[tokenId] → resolve chain + storage + log (~1.5h)
13. `story-verifier-ui` — Proof chain page: ProofChain + LogEntry + StatusBadge components (~2h)
14. `story-e2e-smoke` — End-to-end test: run OpenClaw session → verify tokenId → assert log entries (~1h)

**Estimated coding-agent time:** ~4.5h (story-verifier-api and story-verifier-ui can partially parallel; story-e2e-smoke last)

---

## Epic 6 — Demo & Submission Polish

**Business value:** README, architecture diagram, X post, deployed contracts listed, Vercel deploy confirmed. Required for submission.

**Dependencies:** All prior epics complete

**Out of scope for coding agent:** Demo video recording (Abu handles), X post (Abu approves first), pitch deck (optional).

**Tasks (not stories — no code, orchestrator does not create GitHub issues for these):**
- Write final README.md with architecture diagram + 0G Explorer link + local deploy steps
- Confirm deployed contract address on 0G Galileo Explorer
- Verify Vercel deployment URL is live
- Prepare 0G mainnet deployment (if testnet MVP validated)

---

## Summary

| Epic | Stories | Est. Time | Dependencies |
|---|---|---|---|
| 1 — Logger Core | 3 | 4.5h | None |
| 2 — TEE Proof | 3 | 4h | None |
| 3 — On-chain Anchor | 2 | 3h | Epic 1 |
| 4 — OpenClaw Skill | 3 | 4h | Epic 1, Epic 2 |
| 5 — Dashboard | 3 | 4.5h | Epic 3, Epic 4 |
| 6 — Polish | — | — | All |
| **Total** | **14** | **~20h agent time** | — |
