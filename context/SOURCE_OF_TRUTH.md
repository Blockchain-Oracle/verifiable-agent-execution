# Source-of-truth verdict

**Audited:** 2026-05-01
**Verdict:** the **story files** in `context/docs/stories/` are the source of truth. The 14 GitHub issues (#1–#14) were auto-generated from the same spec dump but drifted into a different (and partly impossible) API surface. Reconcile the issues to the stories, not the other way around.

---

## How the verdict was reached

Four objective tests. All four agree.

### Test 1 — On-chain reality

The pre-deployed `AgenticID` at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on Galileo (16602) is the contract. Whichever spec calls functions that exist on it is the spec that can ship.

```
register(string)           [GH issue #5]   → execution reverted
resolve(string)            [GH issue #5]   → execution reverted
getAgent(uint256)          [GH issue #5]   → execution reverted

iMint(address,IntelligentData[])  [story]  → exists (selector 0x69280041)
getIntelligentDatas(uint256)      [story]  → returns IntelligentData[] (empty for unminted token)
mintFee()                         [story]  → returns 0
creator()                         [story]  → returns 0xad8518cf3510eb2ebb843eb51d209a5f98b768d2
```

Verified via `eth_call` against `https://evmrpc-testnet.0g.ai`. Selectors computed with `ethers.keccak256(toUtf8Bytes("..."))[:10]`.

The deployed contract source is **`0gfoundation/agenticID-examples/examples/01-mint-and-manage/contracts/AgenticID.sol`** — `name()` returns `"Agentic ID"`, `symbol()` returns `"AID"`, both match the constructor of that file. It is **not** the production `0gfoundation/0g-agent-nft/AgentNFT.sol` (which uses `mint(IntelligentData[], address)` + `intelligentDatasOf(uint256)` and has a `verifier()` getter — none of which exist on `0x2700F6A3…`).

### Test 2 — Code-of-record reality

| Claim | Spec saying it | Verified at |
|---|---|---|
| agent-wrapper writes `X-Agent-Id` / `X-Seal-Id` / `X-Signature` / `X-Timestamp` | story files | `0gfoundation/agent-wrapper/internal/proxy/proxy.go` — four `w.Header().Set(...)` calls |
| `TEEVerifier.verifyTEESignature(bytes32, bytes) → bool` | story files + architecture.md | `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol:78-84` |
| Default TEE oracle = `0x04581d192d22510ced643eaced12ef169644811a` | story files + architecture.md | `0gfoundation/0g-agent-nft/scripts/deploy/deploy_tee.ts:13` (hardcoded) |
| `ZG-Res-Key` = `chatID` string verified via `broker.inference.processResponse(addr, chatID)` | architecture.md ADR-07 (rewritten 2026-05-01) | `docs.0g.ai/developer-hub/building-on-0g/compute-network/inference` (via context7 `/websites/0g_ai`) — three independent code samples confirm |
| Storage SDK `@0gfoundation/0g-ts-sdk` exports `ZgFile`, `Indexer`, `MemData` | story files + sdk-snippets | npm registry + unpkg `lib.commonjs/file/index.js` re-exports |
| Compute SDK package | story files (post-fix) | npm registry: `@0glabs/0g-serving-broker` is **deprecated** (description field), renamed to `@0gfoundation/0g-compute-ts-sdk` |
| Galileo chain ID = 16602, Mainnet = 16661 | architecture.md | `eth_chainId` returned `0x40da` and `0x4115` from the respective RPCs |

### Test 3 — Internal coherence

Story files share types (`ExecutionLogEntry`, `SessionLog`, `LogFlushResult`) across files; share file-path conventions (`packages/<name>/src/...`); share test runner (`vitest`); share env-var prefix (`ZG_*`); share chain target (Galileo testnet for dev, mainnet promotion at the end).

GH issues mix mainnet and testnet on per-issue basis (Issue #2 says mainnet for storage, Issue #4 says mainnet for verifier, Issue #14 says mainnet for e2e — but stories all use Galileo for build, mainnet only for the demo polish in Epic 6); mix Express/Hono with Next.js (Issue #12 says "Express or Hono", story says Next.js App Router); use a different env-var prefix (`OG_*` vs `ZG_*`).

### Test 4 — Temporal

```
2026-05-01 16:02:11Z  story files committed (commit 8494bb7)
2026-05-01 16:02:37Z  GH issue #1 created
2026-05-01 16:06:20Z  GH issue #14 created
```

The issues post-date the story dump by under 4 minutes. They appear to have been auto-generated from the stories by a tool that hallucinated the API surface — most plausibly conflating ERC-7857 (intelligent NFT, the standard the deployed contract implements) with ERC-8004 (trustless agents = identity registry). Same name "AgenticID," different standards, different functions.

---

## Practical implications for coding agents

1. **Read the story file, not the GH issue body.** Each issue title contains the story id (e.g., `[story-tee-header-parser] …`); the canonical content is at `context/docs/stories/story-<id>.md`.
2. **For UI work, follow `ux-spec.md`.** `DESIGN.md` defers to it (see that file).
3. **Before implementing any contract call, re-`eth_call`** the deployed `0x2700F6A3…` to confirm the selector you're using actually exists. Selectors that revert with `0x` data don't exist on the contract.
4. **Before implementing any SDK call,** resolve via context7 `/websites/0g_ai` first (the `Library research rule (mandatory)` in `docs/architecture.md`). Training memory of 0G APIs is unreliable — the SDK was renamed in April 2026.
5. **`ZG-Res-Key` is not a signature envelope.** It is a `chatID` string for off-chain `processResponse`. The on-chain TEE proof comes from agent-wrapper's `X-Signature` header. See `architecture.md` ADR-07.
