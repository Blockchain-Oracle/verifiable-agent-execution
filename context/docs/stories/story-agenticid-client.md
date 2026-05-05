# Story: agenticid-client

**Epic:** Epic 3 — On-chain Anchor  
**Estimated time:** ~1.5h  
**Dependencies:** None

---

## Narrative

As a chain client developer, I need an ethers.js wrapper for the pre-deployed AgenticID contract so that session logs can be minted as iNFTs with verifiable on-chain anchors.

---

## Acceptance criteria

```gherkin
Given AgenticIDClient is created with constructor(agenticIdAddress: string, provider: ethers.Provider, signer: ethers.Signer)
And the pre-deployed contract address is `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on Galileo (chain 16602)
When AgenticIDClient.mint(to: string, datas: IntelligentData[]) is called
Then it:
  1. Constructs an iMint() transaction
  2. Sends it via signer
  3. Waits for confirmation (or a specified block count)
  4. Returns { tokenId: bigint, txHash: string }
And the transaction appears on the block explorer within 60 seconds

Given a minted tokenId
When AgenticIDClient.getIntelligentDatas(tokenId) is called
Then it returns the same IntelligentData array that was minted
```

---

## File modification map

**Create:**
- `packages/chain-client/src/AgenticIDClient.ts` — ethers wrapper for iMint, getIntelligentDatas
- `packages/chain-client/src/types.ts` — IntelligentData type (imported from prior-art)
- `packages/chain-client/tests/agenticid-client.test.ts` — Integration test with testnet contract

**Update:**
- `packages/chain-client/src/index.ts` — Export AgenticIDClient, IntelligentData
- `.env.example` — Add AGENTICID_ADDRESS (pre-deployed contract)

---

## Shell verification

```bash
# Set env:
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export PRIVATE_KEY="<testnet-funded-wallet-key>"
export AGENTICID_ADDRESS="0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F"

# Run test (use the SCOPED package name — bare `--filter=chain-client`
# does NOT match the workspace package id, which is
# `@verifiable-agent-execution/chain-client`):
pnpm --filter @verifiable-agent-execution/chain-client exec vitest run agenticid-client.test.ts
# Must exit 0
#
# Without PRIVATE_KEY set, the live-mint integration test is skipped
# and the suite passes via unit + read-only paths. With a funded
# Galileo wallet (faucet at https://faucet.0g.ai), the gated test
# exercises the real iMint round-trip + read-back.
```
