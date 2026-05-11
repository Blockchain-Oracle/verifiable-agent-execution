# Story — Epic-7: Mainnet Deploy + 0G Depth Integration

**Epic:** 07 (mainnet path for 0G APAC Hackathon submission)
**Branch:** `epic/07-mainnet-deploy`
**Status:** Code-complete; awaiting pre-push Codex review.

## Context (motivation)

The 0G APAC Hackathon submission rule (verbatim from `context/01-prizes-tracks.md:31, 44`) **requires** a 0G mainnet contract address + chainscan link. Verified across 5 sources that 0G has not published a public AgenticID on mainnet (see ADR-13). Therefore we deploy our own ERC-7857 instance + MockTEEVerifier on Aristotle mainnet, anchor at least one demo session there, and surface the addresses in submission docs.

Concurrent depth gain: integrate 0G Compute Network's TeeML inference into the anchored demo session so the proof chain includes **on-chain attestation** (iNFT mint) AND **off-chain TEE-verified inference** (Compute Network) — using FOUR 0G primitives, not just one.

## Given / When / Then

### Scenario 1: AgenticID deploys cleanly to both networks

**Given** `contracts/contracts/AgenticID.sol` is a 1:1 copy of `agenticID-examples/01-mint-and-manage/contracts/AgenticID.sol`
**And** `contracts/scripts/deploy-all.ts` orchestrates AgenticID + MockTEEVerifier deploy with the deployer wallet as default TEE oracle
**When** `pnpm --filter @verifiable-agent-execution/contracts deploy:all:testnet` runs
**Then** AgenticID + MockTEEVerifier deploy to Galileo with `name() == "Agentic ID"`, `symbol() == "AID"`, and `mintFee() == 0`
**And** the verifier's `teeOracleAddress()` returns the deployer wallet
**And** deployment records are written to `contracts/deployments/0g-testnet/{AgenticID,MockTEEVerifier}.json`
**Then** the same script run with `--network 0g-mainnet` deploys identically to Aristotle (chainId 16661)
**And** mainnet deployment JSONs land at `contracts/deployments/0g-mainnet/{AgenticID,MockTEEVerifier}.json`

### Scenario 2: MockTEEVerifier accepts deployer-signed sigs after oracle rotation

**Given** mainnet deploy may pick up `TEE_ORACLE_ADDRESS=0x04581d…811a` from `.env` (the canonical 0G oracle, whose private key we don't control)
**When** `pnpm hardhat run scripts/update-oracle.ts --network 0g-mainnet` runs
**Then** `MockTEEVerifier.updateOracleAddress(<deployer>)` is called by the contract owner
**And** the on-chain `teeOracleAddress()` returns the deployer wallet
**And** the deployment JSON's `teeOracleAddress` field is updated to match
**And** the script is idempotent (no-op when the oracle already matches)

### Scenario 3: Demo anchor exercises 0G Compute + 0G Storage + AgenticID on mainnet

**Given** the deployer wallet has ≥ 4 0G on mainnet (3 for 0G Compute Ledger min + ~1 for deploys + gas)
**When** `pnpm exec tsx scripts/smoke/defi-swap-demo-with-compute.ts` runs with mainnet env overrides (`ZG_TESTNET_RPC=https://evmrpc.0g.ai`, `ZG_INDEXER_RPC=https://indexer-storage-turbo.0g.ai`, `AGENTICID_ADDRESS=<mainnet>`)
**Then** `@0gfoundation/0g-compute-ts-sdk` bootstraps the broker (idempotent: best-effort `ledger.depositFund(4)` + `acknowledgeProviderSigner`)
**And** ONE real HTTP `chat/completions` call hits a 0G Compute provider running a TeeML-verified model (e.g., `qwen3.6-plus`)
**And** the response is captured as `type: "inference"` log entry with `{model, provider, endpoint, verificationType, usage}` in `result`
**And** 4 deterministic DeFi swap tool calls (`quote → liquidity → simulate-swap → final-approval`) are appended as `type: "tool_call"` entries, each signed by the deployer wallet in the agent-wrapper protocol format
**And** the 5-entry SessionLog is uploaded to 0G Storage (mainnet indexer)
**And** the rootHash is anchored via `AgenticID.iMint(...)` returning a tokenId
**Then** `chainscan.0g.ai/token/<AgenticID>?a=<tokenId>` resolves the iNFT
**And** `getIntelligentDatas(<tokenId>)` returns the IntelligentData array with `dataDescription: "exec-log:<sessionId>:<modelId>"` and `dataHash: <rootHash>`

### Scenario 4: Dashboard renders OUR Galileo contracts by default (Epic-7 swap)

**Given** `apps/dashboard/src/lib/env.ts` DEFAULTS block points at our Galileo deploys (AgenticID `0xd4a5eA…0E38`, MockTEEVerifier `0x058fc3…C3AD`, chainId 16602)
**When** `pnpm --filter @verifiable-agent-execution/dashboard dev` starts and a browser visits `http://localhost:3000/`
**Then** the landing page renders with new addresses end-to-end:
  - Search placeholder: `tokenId (0)`
  - ERC-7857 mint copy: `AgenticID at 0xd4a5eA…9E38`
  - Footer: `Anchored on 0G Galileo (testnet) · chainId 16602 · AgenticID 0xd4a5eA…9E38 · MockTEEVerifier 0x058FC3…C3AD`
  - TopBar NETWORK chip: `TESTNET` (muted) + `view mainnet ↗` cross-link
  - Latest sessions table: token #0 with the deployer agent address, ANCHORED status
**When** `/verify/0` loads
**Then** the 4-entry DeFi swap session renders with `TEE VERIFIED` green badges on each entry
**And** session-level `/api/verify/0` returns `"verified": "verified"`

### Scenario 5: Coolify-ready nixpacks + env override path for mainnet

**Given** `nixpacks.toml` at the repo root follows the kite-firewall single-deployable pattern with `Base Directory = /`
**When** a Coolify service builds from the repo with `NODE_ENV=development pnpm install --frozen-lockfile`
**Then** `pnpm --filter @verifiable-agent-execution/dashboard build` completes
**And** `pnpm --filter @verifiable-agent-execution/dashboard start` serves the dashboard
**Given** a second Coolify service ("mainnet") is configured with env overrides (`ZG_TESTNET_RPC=https://evmrpc.0g.ai`, `ZG_INDEXER_RPC=https://indexer-storage-turbo.0g.ai`, `AGENTICID_ADDRESS=0xC6f7fB…8937`, `TEE_VERIFIER_ADDRESS=0x4fffB5…58D2`, `CHAIN_ID=16661`)
**Then** the same code build serves mainnet contracts from `lib/env.ts.loadEnv()`
**And** the TopBar NETWORK chip flips to `MAINNET` (accent-verify color) + `view testnet ↗`
**And** the footer auto-detects `(MAINNET)` label, mainnet chainscan host, and mainnet addresses

### Scenario 6: Hardhat tests cover the AgenticID hot paths

**Given** `contracts/test/AgenticID.test.ts` exercises constructor, mint(), mintWithRole(), iMint() + getIntelligentDatas() round-trip, pause/unpause, setMintFee admin-gating
**When** `pnpm test` runs in `contracts/`
**Then** all 14 AgenticID tests pass alongside the 9 existing MockTEEVerifier tests (23/23)
**And** the §14 grep gate is clean on hot paths (no `mock|fake|dummy|hardcoded` tokens in `packages/*/src`, `openclaw-skills/*/src`, `apps/dashboard/src/lib`, or `contracts/contracts/` non-`Mock*.sol` files)

## File map

| Component | Path | New / Modified |
|---|---|---|
| AgenticID source | `contracts/contracts/AgenticID.sol` | NEW |
| ERC-7857 interfaces | `contracts/contracts/interfaces/IERC7857{,Authorize,Cloneable}.sol` | NEW |
| AgenticID deploy script | `contracts/scripts/deploy-agenticid.ts` | NEW |
| Deploy orchestrator | `contracts/scripts/deploy-all.ts` | NEW (TEE oracle default = deployer wallet) |
| Oracle rotation script | `contracts/scripts/update-oracle.ts` | NEW (one-shot fix when deploy picks up old env oracle) |
| AgenticID tests | `contracts/test/AgenticID.test.ts` | NEW (14 tests) |
| pnpm scripts | `contracts/package.json` | MODIFIED (deploy:all:*, deploy:agenticid:*) |
| Compute-integrated demo | `scripts/smoke/defi-swap-demo-with-compute.ts` | NEW (5-entry: 1 inference + 4 tool calls) |
| Demo timeout override | `scripts/smoke/defi-swap-demo.ts` | MODIFIED (STORAGE_UPLOAD_TIMEOUT_MS env override) |
| Dashboard env centralizer | `apps/dashboard/src/lib/env.ts` | MODIFIED (Epic-7 defaults, DEMO_TOKEN_ID, chainscanTokenUrl, shortAddress, networkBadge) |
| Hero CTA + ERC-7857 copy | `apps/dashboard/src/app/page.tsx` | MODIFIED (env-driven Footer + ERC-7857 copy) |
| Verify back-link | `apps/dashboard/src/app/verify/[tokenId]/page.tsx` | MODIFIED |
| Session view fallback URL | `apps/dashboard/src/components/SessionView.tsx` | MODIFIED |
| Search placeholder | `apps/dashboard/src/components/SearchBar.tsx` | MODIFIED |
| TopBar NETWORK chip | `apps/dashboard/src/components/TopBar.tsx` | MODIFIED (NetworkChip + env-derived network name) |
| Coolify nixpacks | `nixpacks.toml` | NEW |
| Dashboard env doc | `apps/dashboard/.env.example` | MODIFIED |
| Doc — README | `README.md` | MODIFIED (Deployments table + mainnet demo session) |
| Doc — DEMO | `DEMO.md` | MODIFIED (tokenId 98 → 0, new addresses) |
| Doc — CLAUDE.md | `CLAUDE.md` | MODIFIED (mainnet addresses, oracle rotation log) |
| Doc — architecture | `context/docs/architecture.md` | MODIFIED (Pre-deployed table refactored, ADR-13 added) |

## Shell verification

```bash
# Local gate
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                            # workspace-package level
pnpm --filter @verifiable-agent-execution/contracts test    # 23 tests pass
pnpm --filter @verifiable-agent-execution/dashboard build   # Next 14 build OK

# §14 grep gate (hot paths)
HOT_PATHS=(packages/logger/src packages/tee-adapter/src packages/chain-client/src \
  openclaw-skills/verifiable-execution/src apps/dashboard/src/lib \
  contracts/contracts/MockTEEVerifier.sol contracts/contracts/AgenticID.sol \
  contracts/contracts/interfaces)
grep -rEl --exclude='Mock*.sol' 'mock|fake|dummy|hardcoded' "${HOT_PATHS[@]}" && exit 1 || echo "clean"

# On-chain reads (mainnet)
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xC6f7fB1511a7483C6e14258c70529e37ec698937","data":"0x06fdde03"},"latest"],"id":1}' \
  https://evmrpc.0g.ai
# → "Agentic ID"

curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2","data":"0x3622983c"},"latest"],"id":2}' \
  https://evmrpc.0g.ai
# → deployer wallet (oracle rotation confirmed)

curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xC6f7fB1511a7483C6e14258c70529e37ec698937","data":"0x6352211e0000000000000000000000000000000000000000000000000000000000000000"},"latest"],"id":3}' \
  https://evmrpc.0g.ai
# → deployer wallet (owns tokenId 0)
```

## Acceptance evidence

| AC | Evidence |
|---|---|
| AgenticID deploys cleanly (Galileo) | Block 32602466, tx `0x57802912…b5071bd`, address `0xd4a5eA…0E38` |
| AgenticID deploys cleanly (mainnet) | Block 32907005, tx `0x2f125874…16c5e636`, address `0xC6f7fB…8937` |
| MockTEEVerifier oracle = deployer (Galileo) | `eth_call(teeOracleAddress)` → deployer |
| MockTEEVerifier oracle = deployer (mainnet) | Oracle rotated via `updateOracleAddress` tx `0xce470fc0…666f6e8a` (block 32907160) |
| Mainnet anchor session live | tokenId 0, tx `0xd1b14b30…dfb6d152`, 5 entries (1 inference + 4 tool_call) |
| 0G Compute TeeML in the loop | Provider `0x992e6396…`, model `qwen3.6-plus`, verifiability `TeeML` |
| Dashboard renders new defaults | Screenshots `epic-07-landing-fixed.png`, `epic-07-network-chip.png`, `epic-07-verify-0.png` |
| 23 hardhat tests pass | `pnpm test` output: "23 passing (917ms)" |
| §14 grep gate clean | "§14 grep gate: clean." |

## Known follow-ups (post-merge, not blocking)

1. **Phase 0c live agent-wrapper container** — `0gfoundation/agent-wrapper` Go repo is currently mostly empty directories (created Apr 28, 2026, source not yet pushed). Once 0G publishes the binary, route the demo through it for actual `X-Signature` header capture. Today the protocol shape is faithful (verified by `scripts/smoke/tee-headers.ts` round-trip); only the runtime path bypasses agent-wrapper.
2. **Coolify two-service wiring** — `nixpacks.toml` ready; setup happens out-of-repo (Coolify dashboard + DNS).
3. **HackQuest submission form** — paste mainnet AgenticID `0xC6f7fB…8937` + chainscan link into the submission.
