# Architecture — Verifiable Agent Execution
**Project:** Verifiable Agent Execution  
**Stack locked:** 2026-05-01  
**Updated:** 2026-05-01

---

## Stack

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript | Node 20 LTS |
| Package manager | pnpm workspaces | pnpm 9.x |
| Smart contracts | Solidity | 0.8.24 |
| Contract toolchain | Hardhat | 2.22.x |
| UI framework | Next.js (App Router) | 14.2.x |
| CSS | Tailwind CSS + shadcn/ui | 3.4.x |
| Testing | Vitest | 1.6.x |
| EVM client | ethers.js | v6 |
| 0G Storage | `@0gfoundation/0g-storage-ts-sdk` | 1.2.8 |
| 0G Compute | `@0gfoundation/0g-compute-ts-sdk` (was `@0glabs/0g-serving-broker`, deprecated re-export) | 0.8.0 |
| TEE inference | 0G Compute Network — TEE-sealed providers | endpoint per provider via `broker.inference.getServiceMetadata()` |
| Deployment (UI) | Vercel | — |
| Dev chain | 0G Galileo Testnet | Chain ID 16602, RPC `https://evmrpc-testnet.0g.ai` |
| Submission chain | 0G Mainnet Aristotle | Chain ID 16661, RPC `https://evmrpc.0g.ai` |

---

## Pre-deployed contracts (background context only — no longer load-bearing on this repo as of Epic-7)

| Contract | Address | Chain | Status |
|---|---|---|---|
| AgenticID (ERC-7857, 0G's example) | `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` | Galileo (16602) | Still on-chain. We no longer point at it — see ADR-13. |
| Default TEE Oracle (per `0g-agent-nft`) | `0x04581d192d22510ced643eaced12ef169644811a` | Galileo (signing address, not a contract) | We no longer use this — our verifier is configured with the deployer wallet as oracle. See ADR-13. |

---

## Contracts to deploy (OUR deploys, Epic-7)

| Contract | Galileo (16602) | Aristotle mainnet (16661) | Purpose |
|---|---|---|---|
| `AgenticID.sol` | `0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38` (block 32602466) | PENDING (Phase 2) | ERC-7857 iNFT for session anchors. 1:1 source from `agenticID-examples/01`. See ADR-13. |
| `MockTEEVerifier.sol` | `0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad` (block 32610650) | PENDING (Phase 2) | Verifies ECDSA sigs against the configured `teeOracleAddress` (= deployer wallet on Galileo; same on mainnet). |

---

## Key libraries

| Library | Purpose | Source |
|---|---|---|
| `@0gfoundation/0g-storage-ts-sdk` | 0G Storage upload (ZgFile → Indexer.upload) | npm |
| `ethers` v6 | Wallet, contract calls, event scanning | npm |
| `openai` | 0G Private Computer (OpenAI-compatible) | npm |
| `@0gfoundation/0g-compute-ts-sdk` | 0G Compute Network broker (formerly `@0glabs/0g-serving-broker` — deprecated, re-export shim only). Endpoints fetched via `broker.inference.getServiceMetadata(providerAddress)`. | npm |
| `hardhat` | Contract compile + deploy | npm |
| `@nomicfoundation/hardhat-ethers` | Hardhat × ethers bridge | npm |
| `vitest` | Unit testing | npm |
| `@testing-library/react` | Dashboard component tests | npm |
| `zod` | Runtime schema validation for log entries | npm |

---

## ADRs

**ADR-01: TypeScript over Go**  
0G TypeScript SDKs (`@0gfoundation/0g-storage-ts-sdk` for Storage, `@0gfoundation/0g-compute-ts-sdk` for Compute) cover everything we need. Coding agents build faster in TS. Go is used by `agent-wrapper` (upstream) which we must not modify.

**ADR-02: Sidecar approach — zero agent-wrapper modification**  
Execution logger is an OpenClaw skill, not a fork of agent-wrapper. The skill reads `X-Agent-Id`, `X-Seal-Id`, `X-Signature`, `X-Timestamp` headers that agent-wrapper already adds to every proxied response. Entirely additive — upstream repo stays clean.

**ADR-03: Pre-deployed AgenticID contract**  
Official 0G deployment at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on Galileo. No need to redeploy ERC-7857. Our only deploy is MockTEEVerifier for dev.

**ADR-04: One iNFT per session**  
Each completed OpenClaw session gets one `iMint()` call producing one token. The token's single `IntelligentData` entry points to the session log blob in 0G Storage. No state accumulation, no update() call — each session is self-contained.

**ADR-05: Session-flush storage model**  
Log is accumulated in-process during the session and flushed as a single JSON blob to 0G Storage at session end. Crash mitigation: write a minimal `{sessionId, startedAt}` checkpoint blob at session start.

**ADR-06: MockTEEVerifier for dev, real TEE for demo**  
Official 0G docs recommend MockOracle for testnet dev. MockTEEVerifier accepts any 65-byte ECDSA sig over a `bytes32` dataHash. For the demo we point the verifier's `teeOracleAddress` storage slot at the canonical 0G TEE oracle `0x04581d192d22510ced643eaced12ef169644811a` (hardcoded in `0gfoundation/0g-agent-nft/scripts/deploy/deploy_tee.ts`). Production verifier source: `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol` — implements `verifyTEESignature(bytes32, bytes calldata) → bool` via OpenZeppelin `ECDSA.recover`.

**ADR-07: TEE proof source — agent-wrapper headers (PRIMARY) and Compute SDK chatID (FALLBACK)**

There are two TEE-signature surfaces in the 0G stack and the spec must pick one. We chose `agent-wrapper`'s headers because they're emitted on every proxied response with a deterministic signing message and an ECDSA hex sig that drops straight into `TEEVerifier.verifyTEESignature(bytes32, bytes)`.

**Primary path (used by the logger):** `agent-wrapper` (`0gfoundation/agent-wrapper/internal/proxy/proxy.go`) sets four response headers on every call:

| Header | Content |
|---|---|
| `X-Agent-Id` | Agent identifier (hex) |
| `X-Seal-Id` | Seal identifier (hex, 64 chars) |
| `X-Signature` | ECDSA signature, 128 hex chars (65 bytes incl. v), over `sealId + "|" + …` |
| `X-Timestamp` | Unix timestamp signed in the message |

Adapter layer: reconstruct the signing message (`sealId + "|" + agentId + "|" + body + "|" + timestamp` — exact format documented at `agent-wrapper/docs/api.md` §"Signature Format"), `keccak256` it → `dataHash`, decode `X-Signature` → 65-byte sig, submit both to `TEEVerifier.verifyTEESignature(dataHash, sig)`.

**Fallback path (Compute Network direct):** A response from `@0gfoundation/0g-compute-ts-sdk` carries a `ZG-Res-Key` header whose value is a **chatID string** (NOT a JSON envelope). It is verified off-chain by `await broker.inference.processResponse(providerAddress, chatID) → boolean`. There is no raw signature surfaced inline — verification happens inside the SDK, calling the provider's signature endpoint. This path does not give us a `(bytes32, bytes)` pair to put on chain unless we also fetch the signature record from the provider via the broker's lower-level API.

**Why agent-wrapper wins for our spec:** the X-* headers are inline, raw, and shaped exactly like `TEEVerifier.verifyTEESignature(bytes32, bytes)` expects. Off-chain `processResponse` is fine for the dashboard's "TEE Verified" badge but does not produce a chain-anchored proof.

**ADR-08: Use the example AgenticID contract; promote later**

The deployed `AgenticID` at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on Galileo is the simplified `agenticID-examples/01-mint-and-manage/AgenticID.sol` (verified by `name()` + `symbol()` + `mintFee()` reads and confirmed against the source-of-truth audit). It does **not** enforce a schema on `IntelligentData[]` — we mint a single entry shaped `{ dataDescription: "exec-log:<sessionId>:<modelId>", dataHash: rootHash }` per session. A live read of token 0 shows the contract has been used "as designed" by the deployer (entries `agent_name`, `model`, `capabilities`, `system_prompt`); our `exec-log:*` shape is a different convention on the same primitive.

For the hackathon scope this is fine. Production migration to `0gfoundation/0g-agent-nft/AgentNFT.sol` (which adds a real `verifier()` getter, an `intelligentDatasOf` accessor instead of `getIntelligentDatas`, and may add schema validation) is **post-hackathon work**. If we ever switch, the call sites change but the wedge does not.

**ADR-09: 0G Chain compiler settings — `evmVersion: "cancun"` is mandatory**

Per `0gfoundation/0g-agent-skills/patterns/CHAIN.md`, all 0G Chain Solidity must be compiled with `evmVersion: "cancun"`. Skipping this produces a contract that deploys cleanly and reverts at runtime with "invalid opcode" because OpenZeppelin's `ECDSA.recover` uses opcodes that need cancun. Story `story-tee-verifier-contract` carries this requirement in its `hardhat.config.ts` template; do not strip it.

**ADR-10: Trust boundary — TEE-rooted, not trustless**

The verification chain only proves attribution and integrity, not correctness. Every receipt is rooted in trust that 0G's TEE oracle (`0x04581d192d22510ced643eaced12ef169644811a`) was generated inside a real, attested Trusted Execution Environment and that its private key has not been compromised. We pitch this as **"TEE-rooted verification"** rather than "trustless verification" — the precision is a feature, not a weakness, because a competent judge can tell the difference. Pitching trustlessness when the trust root is a single oracle key would mislead the audience and lose more points than it would win.

**ADR-11: Demo arc — REVERSE order (verifier first, agent second)**

The judge walkthrough starts from the verifier's seat, not the agent's seat. Judges receive a proof URL cold (no setup, no narration) and verify a stranger's agent run before we reveal what the agent actually did. This is the opposite of the typical "look at our cool agent → here's its log" arc. The wedge being demoed is *how easy it is to **not** trust an agent and still know exactly what happened* — and the only way to demo that wedge faithfully is to put the judge in the verifier's chair from second one. PRD §"Demo moment" carries the 45-second script that codifies this; do not flatten it back into a forward-arc walkthrough.

**ADR-12: Demo task — opinionated, stakes-loaded (DeFi swap simulation)**

The agent's demo task must be *something where verification matters.* A web-search agent demos the proof but not the **need** for the proof — judges intuitively grade higher when the audited action carries weight. We use a multi-step DeFi swap simulation (`quote → liquidity → simulate-swap → final-approval`). Same code as a web-search task; sharper question ("did the agent really execute this?") and clearer market story (autonomous DeFi compliance is a near-future vertical with concrete pull). The agent does NOT submit a real swap — simulation only, so we don't need a funded mainnet vault for the demo.

**ADR-13: Deploy our OWN AgenticID + MockTEEVerifier (Epic-7) — supersedes ADR-03 + ADR-08**

Decided 2026-05-10 in response to two concurrent findings:

1. **Submission rule:** the 0G APAC Hackathon explicitly requires "0G mainnet contract address + 0G Explorer link showing verifiable on-chain activity" (`context/01-prizes-tracks.md:31, 44`). A submission that reads from 0G's testnet AgenticID without owning a mainnet equivalent fails the rule.
2. **No public mainnet AgenticID exists.** Verified across 5 sources (agenticID-examples repo, 0g-agent-nft repo, AIverse blog, mainnet docs, ERC-7857 docs): 0G has not published a public AgenticID on Aristotle. The example contract `0x2700F6A3…EF1F` is testnet-only.

**Decision:** deploy our own ERC-7857 contract, sourced 1:1 from `agenticID-examples/examples/01-mint-and-manage/contracts/AgenticID.sol`, on both Galileo (testnet) AND Aristotle (mainnet). Pair with our own MockTEEVerifier deploy whose `teeOracleAddress` = deployer wallet (so demo signatures recover correctly without needing access to 0G's reference oracle key).

**What this changes:**
- ADR-03 ("use the pre-deployed AgenticID") is obsolete — we no longer depend on 0G's testnet contract for ANY chain.
- ADR-08 ("use the example AgenticID; promote later") becomes "we deploy the example contract OURSELVES on each chain we ship to."
- ADR-06 ("MockTEEVerifier oracle = canonical 0G TEE oracle 0x04581d…") changes — oracle is now the deployer wallet by default. Honest framing in DEMO.md: "off-chain signer simulating TEE seal key on testnet; agent-wrapper integration is the production upgrade path." Per ADR-10 we already framed this as "TEE-rooted, not trustless."

**Galileo deploys (live):**
- AgenticID `0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38` (block 32602466)
- MockTEEVerifier `0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad` (block 32610650)
- Demo session: tokenId 0 with 4 signed entries (`scripts/smoke/defi-swap-demo.ts`).

**Mainnet deploys (Phase 2 — pending wallet funding):**
- Same source contracts, deploy via `pnpm --filter @verifiable-agent-execution/contracts deploy:all:mainnet`.
- `lib/env.ts` defaults swap to mainnet addresses + `CHAIN_ID=16661` per Coolify service env.

**Why this is honest, not a downgrade:** judges see the contract source on chainscan; the contract IS the canonical example; what changes is the deployer + chain. The depth gain (ownership of the on-chain primitive) more than offsets the loss of "we use 0G's official deploy" framing. Phase 0a layered 0G Compute Network on top so the on-chain AgenticID + off-chain TeeML inference both appear in the same anchored session.

---

## Repo structure

```
verifiable-agent-execution/
├── contracts/
│   ├── MockTEEVerifier.sol          # Dev verifier — accepts any valid sig
│   └── interfaces/
│       └── ITEEVerifier.sol          # Shared interface
├── scripts/
│   └── deploy-mock.ts               # Hardhat deploy: MockTEEVerifier
├── hardhat.config.ts
├── packages/
│   ├── logger/                      # Core log capture library
│   │   ├── src/
│   │   │   ├── types.ts             # ExecutionLogEntry, SessionLog, LogFlushResult
│   │   │   ├── SessionLogger.ts     # Accumulate entries, flush to 0G Storage
│   │   │   ├── StorageClient.ts     # 0G Storage upload wrapper → bytes32 root hash
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── session-logger.test.ts
│   │   └── package.json
│   ├── tee-adapter/                 # TEE proof extraction + verification
│   │   ├── src/
│   │   │   ├── HeaderParser.ts      # Parse agent-wrapper X-* headers (X-Agent-Id, X-Seal-Id, X-Signature, X-Timestamp)
│   │   │   ├── TEEProofAdapter.ts   # keccak256(signing-message) + verify via TEEVerifier contract
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── tee-adapter.test.ts
│   │   └── package.json
│   ├── chain-client/                # On-chain interactions
│   │   ├── src/
│   │   │   ├── AgenticIDClient.ts   # iMint, getIntelligentDatas wrappers
│   │   │   ├── SessionAnchor.ts     # Orchestrates flush → mint → return verifyUrl
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── chain-client.test.ts
│   │   └── package.json
│   └── (no openclaw plugin here — see openclaw-skills/ at repo root)
├── openclaw-skills/                 # OpenClaw plugin layout (canonical, mirrors 0g-memory/openclaw-skills/)
│   └── verifiable-execution/
│       ├── openclaw.plugin.json     # Plugin manifest — id + configSchema (NOT SKILL.md)
│       ├── src/
│       │   ├── index.ts             # default-exports activate(api: OpenClawPluginApi)
│       │   ├── hooks.ts             # onSessionStart / onToolCall / onSessionEnd handlers
│       │   ├── SessionManager.ts    # Singleton: manages active logger per session
│       │   └── (no SKILL.md — that is a Claude Code convention, not OpenClaw)
│       ├── tests/
│       │   └── skill.test.ts
│       └── package.json
├── apps/
│   └── dashboard/                   # Next.js verification UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx         # Landing: explain the primitive, link to verify
│       │   │   ├── verify/
│       │   │   │   └── [tokenId]/
│       │   │   │       └── page.tsx # Proof chain view
│       │   │   └── api/
│       │   │       └── verify/
│       │   │           └── [tokenId]/
│       │   │               └── route.ts  # REST: resolve chain → storage → log
│       │   └── components/
│       │       ├── ProofChain.tsx   # Full proof chain renderer
│       │       ├── LogEntry.tsx     # Individual tool call card
│       │       └── StatusBadge.tsx  # "TEE Verified" / "Mock" / "Unverified"
│       ├── tailwind.config.ts
│       ├── package.json
│       └── next.config.ts
├── CLAUDE.md                        # Coding agent instructions (filled by orchestrator)
├── README.md
├── pnpm-workspace.yaml
└── package.json
```

---

## Execution log JSON schema

```typescript
// packages/logger/src/types.ts

interface ExecutionLogEntry {
  seq: number;               // 0-indexed, monotonically increasing
  ts: number;                // Unix timestamp ms
  type: 'tool_call' | 'inference' | 'session_start' | 'session_end';
  tool?: string;             // tool name for type=tool_call
  modelId?: string;          // e.g. "claude-sonnet-4-6"
  inputHash: string;         // sha256(input) hex
  outputHash: string;        // sha256(output) hex
  teeSignature?: string;     // X-Signature header (ECDSA hex, 128 chars / 65 bytes incl. v)
  teeSigningAddress?: string; // recovered signer; expected = TEEVerifier.teeOracleAddress()
  agentId?: string;           // X-Agent-Id header
  sealId?: string;            // X-Seal-Id header
  signedAt?: number;          // X-Timestamp (Unix seconds) — part of the signing payload
}

interface SessionLog {
  sessionId: string;
  startedAt: number;          // Unix timestamp ms
  endedAt: number;
  agentId: string;
  containerHash: string;      // IMAGE_HASH env var (TEE container identity)
  modelId: string;
  entries: ExecutionLogEntry[];
  entryCount: number;
}

interface LogFlushResult {
  rootHash: string;           // bytes32 hex — 0G Storage Merkle root
  entryCount: number;
  sessionId: string;
}
```

---

## Proof verification flow

```
Verifier query: tokenId
      │
      ▼
AgenticIDClient.getIntelligentDatas(tokenId)
      │ returns [{dataDescription: "exec-log:<sessionId>:<modelId>", dataHash: bytes32}]
      ▼
StorageClient.download(dataHash)
      │ returns SessionLog JSON blob
      ▼
TEEProofAdapter.verify(entry.teeSignature, entry.signedAt, signingMessage)
      │ computes keccak256(signingMessage), calls TEEVerifier.verifyTEESignature(hash, sig) → bool
      ▼
{verified: boolean, entries: ExecutionLogEntry[], tokenId, txHash, storageHash}
```

---

## Context7 library research rule (mandatory)

Before implementing any SDK call, resolve library docs first:
```
mcp__context7__resolve-library-id → mcp__context7__query-docs
```

Apply to: `@0gfoundation/0g-storage-ts-sdk`, `ethers` v6, Next.js App Router, shadcn/ui, Vitest.  
Never implement from training-data memory — 0G SDK APIs change frequently.

---

## Banned patterns

- No `from-purple-500 to-pink-500` or any default AI gradient on the dashboard
- No mock/stub in the hot path (§14): 0G Storage upload, iMint, TEEVerifier must call real testnet
- No `shadcn-admin`, TailAdmin, or generic admin scaffolds as starting points
- No `iTransferFrom` or ERC-7857 ownership transfer mechanics (out of scope)
- No credentials hardcoded in source — env vars only (`.env.local` for local, Vercel env for prod)
- No `console.log` in library packages — structured logging only
- No `any` type casts without an inline justification comment
