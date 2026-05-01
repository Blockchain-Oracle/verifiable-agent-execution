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
Given SessionAnchor is created with constructor(sessionLogger: SessionLogger, agenticIdClient: AgenticIDClient, agentId: string, modelId: string)
When SessionAnchor.anchor({ sessionId, containerHash }) is called after session end
Then it:
  1. Calls sessionLogger.flush() → rootHash
  2. Constructs IntelligentData with { dataDescription: "exec-log:<sessionId>:<modelId>", dataHash: rootHash }
  3. Calls agenticIdClient.mint(agentAddress, [data])
  4. Returns { tokenId: bigint, verifyUrl: string, txHash: string }

Given a returned tokenId
When the returned verifyUrl is `/verify/<chainId>/<tokenId>`
Then it is a valid URL pattern (contains tokenId)

Given the transaction is confirmed on-chain
When ethers.js listens for Updated or IntelligentDataSet events from the mint tx
Then at least one event is emitted confirming the data anchor
```

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
# Set env:
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export PRIVATE_KEY="<testnet-funded-wallet-key>"

# Run integration test:
pnpm --filter=chain-client vitest run session-anchor.test.ts
# Must exit 0
```
