# PRD — Verifiable Agent Execution
**Project:** Verifiable Agent Execution  
**Hackathon:** 0G APAC Hackathon (Track 1 — Agentic Infrastructure & OpenClaw Lab)  
**Deadline:** May 16, 2026  
**Updated:** 2026-05-01

---

## Goal

AI agents are increasingly trusted to act autonomously — but today there is no way to prove what an agent actually did. Anyone can claim an agent ran a task correctly; no one can verify it. Verifiable Agent Execution closes this gap: every OpenClaw agent session produces a cryptographically signed, immutably stored, on-chain-anchored proof that anyone can independently verify. The proof chain runs from tool call → TEE signature → 0G Storage hash → iNFT token — making agent accountability as simple as sharing a link.

This is agent accountability infrastructure. The first provable audit trail for AI agents, built natively on 0G.

---

## One-line pitch

"Prove your AI agent ran exactly what it claimed — cryptographic receipts for every session."

---

## Sponsor-native fit

Track 1 (Agentic Infrastructure & OpenClaw Lab). Uses OpenClaw as the orchestration layer and integrates four confirmed 0G primitives in a single coherent flow: 0G Private Computer (TEE-sealed inference with signed responses), 0G Storage (immutable session log persistence), 0G Chain (on-chain AgenticID anchor), and iNFT/ERC-7857 (verifiable proof attestation). First-mover integration of 0G Private Computer, which launched April 28 — no existing gallery project can include it.

---

## Demo moment (judge walkthrough — 5 steps)

> Assume judges have 20 seconds per step and no prior 0G context.

**Step 1 — Run an OpenClaw agent**
Open terminal. Run an OpenClaw session with the `verifiable-execution` skill active: "Research the top AI agent frameworks from the last 6 months." Agent runs normally — calls web search, Tavily, summarizes.

**Step 2 — Skill fires automatically at session end**
No extra command. The skill captures every tool call during the session, flushes a signed JSON log to 0G Storage, and calls `iMint()` on the AgenticID contract.

Terminal output:
```
✓ Session captured: 4 tool calls logged
✓ Log anchored: 0G Storage root 0xabc...def
✓ iNFT minted: token #42 on 0G Galileo
✓ Verify at: https://verifiable.0g.ai/verify/42
```

**Step 3 — Open the verification dashboard**
Navigate to the URL. Dashboard loads — shows the proof chain: session metadata → 4 log entries (tool name, input hash, output hash, TEE signature) → on-chain token info → 0G Storage hash.

**Step 4 — Verify the TEE signature**
Click "Verify Proof". Dashboard calls `TEEVerifier.verifyTEESignature(logHash, teeSignature)` → returns `true`. Status badge changes to "TEE Verified."

**Step 5 — Share the proof link**
Copy the URL. Share it with anyone. They open it, see the same proof chain — without needing a wallet, without trusting the operator. The proof is on 0G Chain and 0G Storage permanently.

---

## The wow moment

"You can prove, cryptographically, that this AI agent actually used these tools in this order — the proof is on-chain forever, and anyone can verify it without trusting us."

---

## Out of scope for this sprint

- Multi-agent swarm logging or cross-agent proof correlation
- Real-time streaming verification (session-flush model: proof created at session end)
- Production Gramine TEE deployment (we leverage 0G Private Computer's existing enclave)
- ERC-7857 ownership transfer proof mechanics (iTransferFrom) — we anchor, not trade
- Revenue model, marketplace, or access gating
- Non-OpenClaw agent runtimes (ElizaOS, AutoGen — post-hackathon extension)
- Mobile / native app

---

## Success criteria (minimum viable demo)

- [ ] OpenClaw session with `verifiable-execution` skill installed completes and auto-anchors
- [ ] `GET /api/verify/{tokenId}` returns HTTP 200 with `logEntries.length >= 1`
- [ ] Dashboard renders proof chain with at least 1 verified log entry
- [ ] `iMint()` tx confirmed on 0G Galileo testnet (Explorer link available)
- [ ] 0G Storage log blob downloadable at the anchored `rootHash`

---

## Judging alignment

| Criterion | How we address it |
|---|---|
| 0G Technical Integration Depth | 4 primitives: Private Computer + Storage + Chain + iNFT. First-mover on 0G Private Computer. |
| Technical Completeness | Mainnet contract address + Explorer link + working demo (not concept-only) |
| Product Value & Market Potential | AI compliance, enterprise audit trails, agent trust infrastructure — real market need |
| UX & Demo Quality | 5-step judge walkthrough, shareable proof URL, dashboard renders without a wallet |
| Documentation | README with architecture diagram, CLAUDE.md, clean GitHub repo |
