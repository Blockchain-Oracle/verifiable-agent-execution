# Story: session-mint

**Epic:** Epic 3 — On-chain Anchor  
**Estimated time:** ~1.5h  
**Dependencies:** story-session-logger, story-agenticid-client

---

## Narrative

As a session orchestrator, I need SessionAnchor to coordinate flushing a session log to 0G Storage and then minting an iNFT on AgenticID to create a permanent on-chain proof link.

---

## Acceptance criteria

```gherkin
Given SessionAnchor is created with constructor(
  sessionLogger: SessionLogger,
  agenticIdClient: AgenticIDClient,
  agentId: string,
  modelId: string,
  options: { chainId: number; confirmations?: number }
)
And options.chainId is REQUIRED (no Galileo default — see "Spec evolution" below)
When SessionAnchor.anchor({ sessionId, containerHash }) is called after session end
Then it:
  1. Calls sessionLogger.flush() → rootHash
  2. Constructs IntelligentData with { dataDescription: "exec-log:<sessionId>:<modelId>", dataHash: rootHash }
  3. Calls agenticIdClient.mint(agentAddress, [data])
  4. Returns { tokenId: bigint, verifyUrl: string, txHash: string, rootHash: string, entryCount: number }

Given a returned tokenId
When the returned verifyUrl is `/verify/<chainId>/<tokenId>`
Then it is a valid URL pattern (contains tokenId AND uses options.chainId, NOT a hardcoded default)

Given the transaction is confirmed on-chain
When ethers.js listens for Updated or IntelligentDataSet events from the mint tx
Then at least one event is emitted confirming the data anchor
And the recovered tokenId surfaces in AnchorResult (proving the event drove the result, not a stub)
```

### Spec evolution — why the constructor takes 5 args, not 4

The original draft used a 4-arg constructor and would have derived
chainId from `agenticIdClient.provider.getNetwork()`. We rejected that
during implementation because:

1. **Silent mainnet-URL risk:** if a preview deploy is wired to a
   mainnet provider but the SessionAnchor was meant for testnet, the
   verifyUrl would silently advertise the wrong chain. The mismatch
   would only surface when a verifier hit `/verify/<wrong-chain>/<id>`
   and got a "token not found."
2. **Network-agnostic design:** SessionAnchor should not depend on the
   network connectivity of the underlying provider for a value that's
   essentially a deployment constant. Forcing the caller to pass it
   makes the deployment intent explicit at construction time.

The 5th `options` arg (`{ chainId, confirmations? }`) is REQUIRED, not
optional, so the type system catches the omission at the call site.
This is a deliberate spec-vs-implementation drift that the BDD now
acknowledges; Codex's first round on PR #19 flagged the original
4-arg-only BDD as inconsistent with the implementation, and the right
fix was to update the spec rather than accept an unsafe default.

---

## File modification map

**Create:**
- `packages/chain-client/src/SessionAnchor.ts` — Orchestrator class with anchor() method
- `packages/chain-client/tests/session-anchor.test.ts` — Integration test: mock SessionLogger → mint → verify

**Update:**
- `packages/chain-client/src/index.ts` — Export SessionAnchor, AnchorResult type
- `packages/chain-client/package.json` — Ensure logger package is available as dependency or peer

---

## Shell verification

```bash
# Set env — ALL FOUR are required for the gated live anchor test
# (the suite skips silently if any are missing, so omitting them
# means the on-chain BDD line stays unverified).
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export ZG_INDEXER_RPC="https://indexer-storage-testnet-turbo.0g.ai"
export AGENTICID_ADDRESS="0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F"  # pre-deployed (ADR-08)
export PRIVATE_KEY="<testnet-funded-wallet-key>"  # 0.1 0G/day from https://faucet.0g.ai

# Run integration test (use the SCOPED package name — bare `--filter=chain-client`
# does NOT match the workspace package id, which is
# `@verifiable-agent-execution/chain-client`. There is no `vitest`
# script in package.json, so vitest must be invoked via `exec`):
pnpm --filter @verifiable-agent-execution/chain-client exec vitest run session-anchor.test.ts
# Must exit 0
# Expect: 15 passed (1 skipped if env is missing → test gating intentional;
# 15 passed (0 skipped) when ALL four env vars are set → live anchor exercised)
```

### How the env maps to the test

| Env var              | Used by                         | Where it lands                                |
|----------------------|---------------------------------|-----------------------------------------------|
| `ZG_TESTNET_RPC`     | `JsonRpcProvider` + `StorageClient.rpcUrl` | network probe + storage tx broadcast         |
| `ZG_INDEXER_RPC`     | `Indexer` constructor            | 0G Storage upload target                      |
| `AGENTICID_ADDRESS`  | `AgenticIDClient` constructor    | iMint contract address                        |
| `PRIVATE_KEY`        | `Wallet` constructor             | signer for both the storage tx + the mint tx  |

The gated suite is `describe.skipIf(!liveAnchorEnvReady)` in
`session-anchor.test.ts` — pins network.chainId === 16602n before
spending gas, runs the full StorageClient → SessionLogger →
AgenticIDClient → SessionAnchor pipeline, then read-back via
`getIntelligentDatas(tokenId)` to prove the on-chain anchor is
queryable (the BDD's "at least one event ... data anchor" condition
is satisfied iff getIntelligentDatas returns the expected entry).
