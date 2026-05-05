# Reference-repo audit

**Audited:** 2026-05-05
**Scope:** outwards-facing audit — does our architecture fit 0G's actual integration shape?
**Companion to:** `context/SOURCE_OF_TRUTH.md` (artifact-consistency audit, 2026-05-01)
**Verdict:** **PATCH** — wedge is sound, architecture fits, but 5 concrete spec drifts must be corrected before implementation begins.

---

## TL;DR

- Wedge survives: `0g-memory` does not overlap (private memory, not public audit). `agent-wrapper` provides the per-response signature primitive that our spec composes on top of, not duplicates.
- Architecture fits: agent-wrapper → OpenClaw → our skill → SessionLogger → 0G Storage → AgenticID.iMint() is a coherent path through the actual 0G stack.
- 5 spec drifts caught by the smoke tests + reference-repo comparison. All of them are localized fixes; none require redesign.
- 1 architectural watch-out: we mint a new iNFT per session with a single non-canonical `IntelligentData` entry. Production AgentNFT may add schema validation that the example contract does not enforce.

---

## Methodology

Cloned five canonical repos from `0gfoundation/*` into `/tmp/og-refs/`:

```
/tmp/og-refs/0g-storage-ts-starter-kit/   # canonical Storage upload/download
/tmp/og-refs/agenticID-examples/          # source of the deployed 0x2700F6A3...
/tmp/og-refs/agent-wrapper/               # canonical TEE-wrapped agent runtime
/tmp/og-refs/0g-memory/                   # the existing capture-to-storage product
/tmp/og-refs/0g-agent-skills/             # official patterns (STORAGE/CHAIN/COMPUTE/...)
```

Then ran two smoke tests inside the repo (`scripts/smoke/storage.ts` + `scripts/smoke/agenticid.ts`) — they import the real SDKs, exercise the spec's API surface, and report what differs from the story files. Both compile and run.

---

## Findings

### F1 — package name drifted again (now `@0gfoundation/0g-storage-ts-sdk`)

**Story files + my prior patch claim:** `@0gfoundation/0g-ts-sdk`
**Truth (npm registry, every published version):**

```
1.1.0 — 1.2.8: deprecated, "This package has moved. Please use @0gfoundation/0g-storage-ts-sdk instead."
```

Both packages still resolve and both ship the same code (1.2.8 in lockstep), but the canonical name is now `@0gfoundation/0g-storage-ts-sdk`. `package.json` and the smoke test now use the new name.

**Action:** patch architecture.md, sdk-snippets.md, story-storage-client.md, sponsor-docs.

---

### F2 — `MerkleTree.rootHash()` returns `string | null`

**Story claim (`story-storage-client.md`):** `upload(buffer)` returns "rootHash is a valid bytes32 hex string (66 characters, 0x-prefixed)" — implicit non-null.
**SDK type (`@0gfoundation/0g-storage-ts-sdk/types/file/MerkleTree.d.ts`):**

```typescript
rootHash(): string | null;
```

Smoke test compile failed without explicit null-check. Caught by `pnpm exec tsc --noEmit`.

**Action:** patch story-storage-client BDD to require an explicit null-check on the upload path.

---

### F3 — upload return shape is `{rootHash, txHash, txSeq}`, not `{rootHash, entryCount}`

**Story claim:** `upload(buffer)` returns `{rootHash: string, entryCount: number}`.
**SDK type (`Indexer.d.ts`):**

```typescript
upload(...): Promise<[
  ({ txHash: string; rootHash: string; txSeq: number; }
   | { txHashes: string[]; rootHashes: string[]; txSeqs: number[]; }),
  Error | null
]>;
```

`entryCount` is fiction. The real return is a Go-style `[result, err]` tuple where the result is either the single-tx shape or the fragmented multi-tx shape. There's also `txSeq` which is the SDK's internal sequence number — useful to expose.

**Action:** patch story-storage-client to specify the real return shape AND the `[result, err]` calling convention. Spec should also choose: do we collapse fragments into the first chunk's `rootHash`, or surface both?

---

### F4 — `evmVersion: "cancun"` is REQUIRED for 0G Chain

**Story claim (`story-tee-verifier-contract.md`):** uses default Hardhat config.
**Truth (`0g-agent-skills/patterns/CHAIN.md`):**

```typescript
solidity: {
  version: '0.8.24',
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' /* REQUIRED */ },
}
```

Compiled without `cancun`, our `MockTEEVerifier` would deploy fine but revert at runtime with "invalid opcode" because OpenZeppelin `ECDSA.recover` uses opcodes that need cancun. This is exactly the class of late-discovered failure we've been warned about.

**Action:** patch story-tee-verifier-contract to mandate `evmVersion: 'cancun'` in hardhat.config.ts. Also add the canonical network names: `0g-testnet` (chainId 16602) and `0g-mainnet` (chainId 16661) — our story uses `zgTestnet`.

---

### F5 — OpenClaw plugin manifest is `openclaw.plugin.json`, not `SKILL.md`

**Story claim (`story-skill-init.md`):** "`packages/openclaw-skill/SKILL.md` is created with skill name, description, metadata."
**Truth (`0g-memory/openclaw-skills/evermemos/`):** the canonical OpenClaw plugin layout is

```
openclaw-skills/<plugin>/
├── openclaw.plugin.json   ← manifest with id + configSchema
├── package.json
└── src/index.ts           ← imports OpenClawPluginApi from "openclaw/plugin-sdk/core"
```

There is no `SKILL.md` in the canonical layout. We hallucinated that from Claude Code skill conventions. `openclaw.plugin.json` is the real manifest.

**Action:** patch story-skill-init: swap `SKILL.md` for `openclaw.plugin.json` (with `id` + `configSchema`); import `OpenClawPluginApi` from `openclaw/plugin-sdk/core`; move skill into the `openclaw-skills/<id>/` layout (we currently say `packages/openclaw-skill/`).

---

## Architectural fit on the 0G stack (where we sit)

```
                     ┌──────────────────────────────────┐
                     │ 0g-sandbox (TEE container host) │
                     └──────┬───────────────────────────┘
                            │ starts container
                            ▼
        ┌──────────────────────────────────────────────────┐
        │ agent-wrapper (Go) inside TEE                    │
        │  - reads agent metadata from chain (ERC-7857)    │
        │  - decrypts config from 0G Storage               │
        │  - dynamically installs OpenClaw                 │
        │  - proxies HTTP :8080 → :9000 and SIGNS          │  ← X-Agent-Id, X-Seal-Id,
        │    every response with the seal key              │    X-Signature, X-Timestamp
        └──────────────────────┬───────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────┐
        │ OpenClaw runtime                                 │
        │  - executes agent task                           │
        │  - calls tools (web search, etc.)                │
        │  - hosts plugins from openclaw-skills/           │
        └──────────────────────┬───────────────────────────┘
                               │
                               ▼   ← our verifiable-execution PLUGIN sits here
        ┌──────────────────────────────────────────────────┐
        │ verifiable-execution (TS plugin)                 │
        │  onSessionStart → init SessionLogger             │
        │  onToolCall → append entry (capture sig hdrs)    │
        │  onSessionEnd → flush log to 0G Storage          │
        │                  + AgenticID.iMint(rootHash)     │
        └──────────────────────────────────────────────────┘
                       │                       │
                       ▼                       ▼
              ┌──────────────────┐    ┌──────────────────┐
              │ 0G Storage       │    │ 0G Chain         │
              │ (rootHash for    │    │ (AgenticID iNFT  │
              │  session log)    │    │  with rootHash)  │
              └──────────────────┘    └──────────────────┘
                       ▲                       ▲
                       └─────────┬─────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ verifier dashboard           │
                  │ (Next.js, public, no wallet) │
                  └──────────────────────────────┘
```

**Verdict:** the diagram has no architectural cycles, no impossible dependencies, and no overlap with the existing `0g-memory` flow (which writes to a separate, encrypted, per-user namespace for the agent's OWN consumption). The wedge sits cleanly on top of agent-wrapper's existing signature primitive.

---

## Wedge sanity vs the existing field

### `0g-memory` (capture mechanism, but different goal)

`0g-memory/README.md`: *"every prompt — every prompt, response, and tool call — is automatically captured and retrieved in future sessions"* + *"encrypted with a key only you hold"*.

- **0g-memory** captures to **encrypted** storage for the agent's **own** future-session recall (private memory).
- **verifiable-agent-execution** captures to **public, hash-anchored** storage for **third-party** verification (audit trail).

These are different access patterns and different consumers. No merge or redundancy. We could optionally piggyback on 0g-memory's capture hooks (their `openclaw-skills/evermemos/src/index.ts` shows the canonical pattern), but the storage layer and the public/private posture are different enough that a parallel skill is justified.

### `agent-wrapper` (signature primitive, no anchor)

`agent-wrapper/docs/api.md`: signs every proxied response as `Sign(agentId + "|" + sealId + "|" + timestamp + "|" + sha256(responseBody))`.

- agent-wrapper produces **per-response signatures** (X-Signature headers) but does **not** anchor them to chain or to durable storage. The signature is ephemeral — it dies with the response.
- Our wedge is the **anchor + audit-trail layer**: we collect the X-Signature headers across a session, write the log to 0G Storage, and mint an iNFT pointing to it. The signature lifetimes go from "current request" to "permanent on-chain proof."

Composition is the right relationship here.

### Prior winners (Care-AI, OpenMemory, Ajently — per `CONTEXT.md`)

I did not deeply re-verify the shapes of prior winners (gh search returned nothing immediately actionable, and CONTEXT.md already has a competitor-analysis pass). Flagging this as **uncertainty** to surface explicitly: if you want a prior-winner shape comparison, that's a separate ~30 min spike.

---

## One architectural watch-out

The deployed `AgenticID` at `0x2700F6A3…` is the simple example contract — no schema enforcement on `IntelligentData[]`. We use it loosely: each session mints a new token with `[{dataDescription: "exec-log:<sessionId>:<modelId>", dataHash: rootHash}]`.

A live mint at token 0 (read by our smoke test) shows the contract has been used "as designed" by 0G — with `agent_name`, `model`, `capabilities`, `system_prompt` entries describing an agent. Our usage uses the same primitive for a different shape of data (audit-log pointer).

**Risk:** if we later switch to the production `0gfoundation/0g-agent-nft/AgentNFT.sol` (which has a real `verifier()` and may enforce IntelligentData schemas), our `exec-log:*` entries might be rejected. **For the hackathon we stay on the example contract — this is fine.** Worth a comment in the spec; not worth a redesign.

---

## Smoke-test results

### `scripts/smoke/storage.ts` — story-storage-client

- `tsc --noEmit`: PASS (after F2 null-fix). Caught the `MerkleTree.rootHash()` null case.
- Live upload not run (no funded testnet wallet at audit time). To run: `PRIVATE_KEY=0x... pnpm exec tsx scripts/smoke/storage.ts`.
- Documents the exact `[result, err]` calling convention vs the story's "throw" assumption.

### `scripts/smoke/agenticid.ts` — story-agenticid-client

- `tsc --noEmit`: PASS.
- Live read PASS against `0x2700F6A3…` on Galileo:
  - `chainId == 16602` ✓
  - `name() == "Agentic ID"` ✓
  - `symbol() == "AID"` ✓
  - `mintFee() == 0` ✓ (no msg.value needed)
  - `creator() == 0xad8518cf3510eb2ebb843eb51d209a5f98b768d2` ✓
  - `getIntelligentDatas(0)` returned a real previously-minted token with 4 entries (`agent_name`, `model`, `capabilities`, `system_prompt`) — proves contract behaves as documented
  - `iMint(...)` calldata encodes to selector `0x69280041` ✓ (matches `keccak256("iMint(address,(string,bytes32)[])")[:4]`)

The smoke tests live in the repo and re-run via `pnpm exec tsc --noEmit` (compile) or `pnpm exec tsx scripts/smoke/<name>.ts` (live). They're future-proof: any spec drift will fail tsc next time.

---

## Action items for the spec

Concrete, in-order edits the next agent (or me) should land before any Epic-1/2 implementation begins:

1. `context/docs/architecture.md`, `context/docs/stories/story-storage-client.md`, `context/refs/sdk-snippets.md`, `context/02-sponsor-docs.md`: replace `@0gfoundation/0g-ts-sdk` with `@0gfoundation/0g-storage-ts-sdk` (F1).
2. `story-storage-client.md`: rewrite the BDD acceptance to specify `[result, err]` tuple, real return shape `{rootHash, txHash, txSeq}`, and the `MerkleTree.rootHash() === null` failure mode (F2 + F3).
3. `story-tee-verifier-contract.md`: mandate `evmVersion: "cancun"` in hardhat.config.ts (F4); rename network from `zgTestnet` to `0g-testnet` to match `agent-skills/patterns/CHAIN.md`.
4. `story-skill-init.md`: change skill manifest from `SKILL.md` to `openclaw.plugin.json` with `id` + `configSchema`; change layout from `packages/openclaw-skill/` to `openclaw-skills/<id>/`; adjust imports to `openclaw/plugin-sdk/core` (F5).
5. `architecture.md`: add a one-line ADR-08 noting that we use the **example** AgenticID contract (no schema enforcement) and our `IntelligentData[]` shape is `[{dataDescription: "exec-log:<sessionId>:<modelId>", dataHash}]`. Production AgentNFT compatibility is post-hackathon.

After patching, re-run the artifact-consistency audit (`SOURCE_OF_TRUTH.md` 4-test protocol) one more time so internal consistency is restored.

---

## What's still untested

I'm flagging these honestly so they don't get silent-shipped:

- **Live mint** of an iNFT (no funded testnet wallet at audit time). The calldata encodes correctly and the read-side works; the actual write path is unverified.
- **Live upload** to 0G Storage (same wallet constraint).
- **Compute SDK live test** (`processResponse(provider, chatID)` round-trip). We have docs-level proof but no smoke test.
- **`agent-wrapper` X-Signature reconstruction** — the signing-message format is documented in `agent-wrapper/docs/api.md` §"Signature Format" but I haven't validated against a captured response. Worth a third smoke test before story-tee-proof-flow lands.
- **Prior-winner shape comparison** — covered by `CONTEXT.md`'s analysis but not re-validated against actual code.

---

## Bottom line

The wedge is sound. The architecture fits. Five concrete spec patches needed (all localized). One architectural watch-out (use of example contract). Three smoke tests would close the live-write gap.

This is a **PATCH**, not a **PIVOT**.
