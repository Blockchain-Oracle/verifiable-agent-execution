# 0G APAC Hackathon — Open Questions Resolved
**Date:** 2026-05-01  
**Project:** Verifiable Agent Execution  
**Deadline:** May 16, 2026 (15 days remaining)

---

## Q1: 0G Storage Write/Upload API

### Answer
0G Storage does **not expose direct REST endpoints** (PUT, POST) for file uploads. Instead, it provides **SDKs (TypeScript and Python)** that use an **Indexer RPC endpoint** for uploads.

**Upload mechanism:**
- TypeScript SDK (`@0glabs/0g-ts-sdk`): Create `ZgFile` object → call `merkleTree()` → upload via `Indexer.upload()`
- Python SDK (`0g-storage-sdk`): Same pattern with `Indexer` class and `upload()` method
- Indexer RPC endpoints (e.g., `https://indexer-storage-testnet-turbo.0g.ai`)

**Hash derivation:**
- Uses **File Merkle Tree** (not SHA-256 or Keccak256 directly)
- The `merkleTree()` method generates the file root hash
- Tree structure uses Keccak256 internally for node hashing
- Chunk size: 256 bytes (default)
- Segment size: 256 KB (262,144 bytes)

**Fee model:**
- **One-time storage fee** (not per-transaction)
- Two networks: **Turbo** (faster, higher fee) and **Standard** (slower, lower fee)
- Cost scales with file size

**Rate limits and max file size:**
- **Not documented in public materials** — defaults appear to be fragment size of 4GB for large files
- No published rate-limiting policies found

**Authentication:**
- Requires private key with balance (for gas fees on blockchain side)
- SDK uses ethers.Wallet pattern

### Source
- [Storage SDK Documentation](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk)
- [0G TypeScript SDK](https://github.com/0glabs/0g-ts-sdk)
- [0G Python SDK (PyPI)](https://pypi.org/project/0g-storage-sdk/0.1.0/)
- [0G TS SDK npm](https://www.npmjs.com/package/@0glabs/0g-ts-sdk)

### Confidence
**High** for the Indexer RPC + SDK approach and merkle tree hash method (found in official docs and README).  
**Medium** for rate limits and max file size (not documented; inferred from code defaults).

### Remaining Uncertainty
- Exact rate limiting per Indexer node (if any)
- Max file size hard limits
- Detailed gas costs for storage transactions (depends on network, file size, chain congestion)

---

## Q2: TEE Oracle Address on Galileo Testnet

### Answer — UPDATED 2026-05-01 (deep research pass)

**Critical architecture clarification first:** The "TEE oracle" is NOT an on-chain smart contract. It's an off-chain signing key that lives inside Intel TDX hardware (a Confidential Virtual Machine). 0G's Sealed Inference system works like this:

1. Each 0G Compute Network provider generates an **enclave-born key pair** at startup inside the TEE. The private key never leaves the secure enclave.
2. CPU + GPU attestation reports bind the public key to the TEE hardware, creating a verifiable chain.
3. Every inference response is **cryptographically signed** with this enclave-born private key.
4. The **TEEVerifier smart contract** stores the oracle's public Ethereum address and verifies signatures from it on-chain.

So: oracle = the TEE hardware's signing identity (an Ethereum address). TEEVerifier = the on-chain contract that checks if a proof was signed by that identity.

---

### Key finding: hardcoded default oracle address in 0G's own deploy scripts

In `0gfoundation/0g-agent-nft` → `scripts/deploy/deploy_tee.ts` (read directly from GitHub):

```typescript
const oracleAddress = process.env.ORACLE_ADDRESS || "0x04581d192d22510ced643eaced12ef169644811a";
```

**`0x04581d192d22510ced643eaced12ef169644811a`** is 0G's hardcoded default TEE oracle address for testnet deployments. This is the enclave-born public signing key of their reference TEE provider on Galileo. Source is the official `0gfoundation` org, not community code — high confidence this is the real address.

**Important caveat:** This address only produces valid signatures when you make inference calls through 0G Compute Network / 0G Private Computer (`pc.0g.ai`). The oracle is the TEE hardware itself — it only signs outputs it actually computed inside the enclave.

---

### Key finding #2: official docs explicitly recommend MockOracle for testing

From `docs.0g.ai/developer-hub/building-on-0g/inft/integration` (read directly):

```javascript
// Deploy mock oracle for testing (replace with real oracle in production)
const MockOracle = await ethers.getContractFactory("MockOracle");
const oracle = await MockOracle.deploy();
```

**0G themselves say to use a mock oracle for testnet dev.** This is the official recommended path for anyone who isn't going all-in on real TEE proofs.

---

### Key finding #3: the deploy flow is two contracts, not one

From `deploy_tee.ts` and `deploy_verifier.ts` in the `0g-agent-nft` repo:

1. **Deploy TEEVerifier** — stores the oracle address (`0x04581d...`) and implements `verifyTEESignature()`
2. **Deploy Verifier** — takes TEEVerifier address as `attestationContract`, wraps it as oracle type 0 (TEE)
3. **Deploy AgentNFT** — the main ERC-7857 contract, references the Verifier

You always deploy your own TEEVerifier + Verifier contracts. You do NOT deploy the oracle itself.

---

### Recommended approach for the hackathon build

**Phase 1 (dev/testing — Galileo testnet):**
- Deploy MockOracle → deploy TEEVerifier pointing to MockOracle → deploy Verifier + AgentNFT
- Use MockOracle to skip real TEE proof validation during development
- Lets you test the full contract flow without real 0G Private Computer calls

**Phase 2 (demo/mainnet — live TEE proofs):**
- Use 0G Private Computer (`pc.0g.ai`) for all agent inference
- PC responses are cryptographically signed by their TEE oracle
- Deploy TEEVerifier with oracle address `0x04581d192d22510ced643eaced12ef169644811a`
- Submit the signed response as the `proof` parameter in your AgentNFT contract

**One Discord question worth asking (now much more specific):**
> "Is `0x04581d192d22510ced643eaced12ef169644811a` still the active TEE oracle signer address on Galileo? Or has it rotated?"

This replaces the vague "do you have a public oracle?" question.

---

### Deployment commands (confirmed)

```bash
git clone https://github.com/0gfoundation/0g-agent-nft.git
cd 0g-agent-nft
pnpm install
# set .env: ZG_TESTNET_PRIVATE_KEY, etc.
pnpm hardhat deploy --network zgTestnet
# Output: TEEVerifier at 0x..., Verifier at 0x..., AgentNFT at 0x...
```

Network config:
- Galileo testnet: Chain ID `16602`, RPC `https://evmrpc-testnet.0g.ai`
- Explorer: `https://chainscan-galileo.0g.ai`
- Faucet: `https://faucet.0g.ai` (0.1 OG/day)

### Source
- `0gfoundation/0g-agent-nft` → `scripts/deploy/deploy_tee.ts` (GitHub, read directly — primary source)
- `0gfoundation/0g-agent-nft` → `scripts/deploy/deploy_verifier.ts` (GitHub, read directly)
- [INFT Integration Guide](https://docs.0g.ai/developer-hub/building-on-0g/inft/integration) (official docs — MockOracle recommendation)
- [0G Sealed Inference announcement](https://www.globenewswire.com/news-release/2026/03/06/3250768/0/en/0g-introduces-sealed-inference-cryptographically-private-ai-where-every-response-is-verified-inside-a-hardware-enclave.html) (enclave-born key architecture)
- `0gfoundation/agent-wrapper` → `CLAUDE.md` + `README.md` (TEE agent lifecycle context)

### Confidence
**High** on architecture (enclave-born keys, TEEVerifier pattern, MockOracle for testing — all from official sources).  
**Medium-High** on oracle address `0x04581d...` — hardcoded in official deploy scripts, but not independently verified on-chain (Galileo explorer is JS-heavy, raw fetch returned empty).

### Remaining Uncertainty
- Whether `0x04581d192d22510ced643eaced12ef169644811a` is still the active oracle on Galileo (may have rotated since script was last updated — last push was 2026-03-04)
- Whether 0G Private Computer outputs include the oracle signature in a format directly usable as ERC-7857 proof — or if an adapter is needed
- MockOracle source code location in the repo (not found in quick scan — may need to look in `contracts/` or `test/`)

---

## Q3: Gas Cost on 0G Galileo Testnet

### Answer

**Gas token:** `OG` (0G's native token)

**Current gas price:**
- **Not published** in public documentation
- Galileo testnet "targets low fees and fast blocks for rapid iteration" but metrics are "intentionally fluid in test conditions"
- Specific gas prices vary with network load

**iMint() gas cost estimate:**
- **Not documented** for Galileo testnet
- No public transactions with cost data found in block explorer
- Estimated range: **very rough guess** 50k–200k gas per iMint call (standard ERC-721 mint is ~50k; ERC-7857 with metadata/TEE adds overhead)
- **Cost in USD:** Without gas price, cannot estimate

**Testnet token access:**
- **Faucet:** https://faucet.0g.ai
- **Daily limit:** 0.1 OG per wallet
- **Multiple faucet options:** Chainlink, Google Cloud, FaucetMe, etc.

**Cheaper alternatives for on-chain anchoring:**
If iMint proves expensive:
1. **Batch multiple iMints** in one transaction (saves base transaction overhead)
2. **Use 0G Storage hash** (off-chain) + single on-chain anchor transaction
3. **Consider a rollup or L2** if available (not yet mentioned for 0G Galileo)
4. **Store only the root hash** instead of full IntelligentData entries

### Source
- [0G Testnet Overview](https://docs.0g.ai/developer-hub/testnet/testnet-overview)
- [0G Faucet](https://faucet.0g.ai)
- [Chainlink 0G Faucet](https://faucets.chain.link/0g-testnet-galileo)
- [Introducing Galileo Testnet](https://0g.ai/blog/introducing-v3-testnet-galileo)
- [0G Block Explorer (ChainScan)](https://chainscan-galileo.0g.ai)

### Confidence
**Low** for specific iMint costs — documentation does not publish gas metrics and testnet conditions are intentionally variable.  
**High** for faucet and token symbol.

### Remaining Uncertainty
- Actual current gas price (gwei) on Galileo
- Realistic gas cost for iMint() with 1-2 IntelligentData entries
- Whether any optimizations are available in the contract

**Action:** Deploy a test iMint on Galileo testnet and measure the actual gas cost. Run multiple times to get an average.

---

## Summary Table

| Question | Status | Blocker? | Next Step |
|----------|--------|----------|-----------|
| **Q1: Storage upload API** | **Answered** ✓ | No | Use Indexer SDK (TypeScript or Python) |
| **Q2: TEE oracle address** | **Partial** ⚠ | Likely yes | Deploy own or contact 0G Discord |
| **Q3: Gas costs** | **Partial** ⚠ | No (testnet) | Deploy test iMint to measure |

---

## Recommendations for Spec

1. **Q1:** Your agent-wrapper upload code should use the 0G Storage SDK's `Indexer.upload()` method, not attempt direct REST endpoints.
2. **Q2:** Plan to deploy a test TEEVerifier contract as part of your setup. Add to CLAUDE.md as a pre-flight step.
3. **Q3:** Don't gate spec on exact gas costs. Allocate ~200k gas per iMint as a conservative estimate. Test on Galileo during development.

**Timeline impact:** Q2 (TEE oracle) is the only potential blocker. If 0G publishes a public testnet oracle, you're good. Otherwise, +2–4h to deploy and test your own.

