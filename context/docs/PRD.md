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

**"Etherscan for AI agents — share a URL, verify any agent run cold."**

Sub-headline (longer form): *"Prove your AI agent ran exactly what it claimed — cryptographic receipts for every session, anchored on 0G."*

The Etherscan analogy is load-bearing for the pitch: every web3 dev already understands "open a URL → see what happened on chain → verify cryptographically with no wallet." We extend that mental model from transactions to agent runs. Familiarity is the wedge.

---

## Sponsor-native fit

Track 1 (Agentic Infrastructure & OpenClaw Lab). Uses OpenClaw as the orchestration layer and integrates four confirmed 0G primitives in a single coherent flow: 0G Private Computer (TEE-sealed inference with signed responses), 0G Storage (immutable session log persistence), 0G Chain (on-chain AgenticID anchor), and iNFT/ERC-7857 (verifiable proof attestation). First-mover integration of 0G Private Computer, which launched April 28 — no existing gallery project can include it.

---

## Demo moment (judge walkthrough — REVERSE ARC, ~45 seconds total)

> The demo deliberately starts from the **verifier's seat**, not the agent's seat. Judges receive a proof URL cold — no setup, no context — and verify a stranger's agent run before we reveal what happened. This subverts the typical "look at our cool agent" arc; the wedge is *how easy it is to NOT trust an agent and still know exactly what it did.*

**Step 1 — Cold open: judge gets a URL** (5s)
Hand the judge a single link: `https://verifiable.0g.ai/verify/<tokenId>`. No explanation. They open it.

**Step 2 — Page renders the proof chain** (10s)
Two stacked panels:
- **What the agent did** — a 4-row timeline of tool calls (e.g., `quote`, `liquidity`, `simulate-swap`, `final-approval`) with input/output hashes and timestamps.
- **One button:** `Verify on chain`.

**Step 3 — Click "Verify on chain"** (10s)
Dashboard makes three live reads:
1. `AgenticID.getIntelligentDatas(tokenId)` → returns `IntelligentData{exec-log, dataHash}`.
2. 0G Storage download by `dataHash` → fetches the JSON log.
3. `TEEVerifier.verifyTEESignature(keccak256(content), sig)` for each entry → boolean per row.

The four row badges flip from grey to **TEE Verified ✓** in sequence.

**Step 4 — Reveal what the agent actually did** (15s)
Now we tell the story behind the run: *"This was an autonomous DeFi agent simulating a USDC→ETH swap on a hypothetical lending market. It quoted, checked liquidity, simulated, and asked for human approval before executing — and you just verified all four steps cryptographically without a wallet."* The stakes-loaded task is what makes the verification matter.

**Step 5 — "Anyone can do this"** (5s)
Send the same URL to your phone. Open it on a different device. Same proof, same green checkmarks, no wallet, no login. The proof outlives us.

---

## The wow moment

"You verified a stranger's AI agent run in 30 seconds, without trusting us, without trusting them — just by clicking a link. **Etherscan for AI agents.**"

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
