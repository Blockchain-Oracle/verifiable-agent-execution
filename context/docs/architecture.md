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
| 0G Storage | `@0gfoundation/0g-ts-sdk` | 1.2.8 |
| 0G Compute | `@0gfoundation/0g-compute-ts-sdk` (was `@0glabs/0g-serving-broker`, deprecated re-export) | 0.8.0 |
| TEE inference | 0G Compute Network — TEE-sealed providers | endpoint per provider via `broker.inference.getServiceMetadata()` |
| Deployment (UI) | Vercel | — |
| Dev chain | 0G Galileo Testnet | Chain ID 16602, RPC `https://evmrpc-testnet.0g.ai` |
| Submission chain | 0G Mainnet Aristotle | Chain ID 16661, RPC `https://evmrpc.0g.ai` |

---

## Pre-deployed contracts (DO NOT redeploy)

| Contract | Address | Chain |
|---|---|---|
| AgenticID (ERC-7857) | `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` | Galileo (16602) |
| Default TEE Oracle | `0x04581d192d22510ced643eaced12ef169644811a` | Galileo (signing address, not a contract) |

---

## Contracts to deploy

| Contract | Purpose |
|---|---|
| `MockTEEVerifier.sol` | Accepts any valid ECDSA signature for dev/test. Swap to real oracle at demo time. |

---

## Key libraries

| Library | Purpose | Source |
|---|---|---|
| `@0gfoundation/0g-ts-sdk` | 0G Storage upload (ZgFile → Indexer.upload) | npm |
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
0G TypeScript SDKs (`@0gfoundation/0g-ts-sdk` for Storage, `@0gfoundation/0g-compute-ts-sdk` for Compute) cover everything we need. Coding agents build faster in TS. Go is used by `agent-wrapper` (upstream) which we must not modify.

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
│   └── openclaw-skill/              # OpenClaw skill entrypoint
│       ├── SKILL.md
│       ├── src/
│       │   ├── hooks.ts             # onSessionStart, onToolCall, onSessionEnd
│       │   ├── SessionManager.ts    # Singleton: manages active logger per session
│       │   └── index.ts
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

Apply to: `@0gfoundation/0g-ts-sdk`, `ethers` v6, Next.js App Router, shadcn/ui, Vitest.  
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
