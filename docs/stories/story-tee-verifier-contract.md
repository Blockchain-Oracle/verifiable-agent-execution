# Story: tee-verifier-contract

**Epic:** Epic 2 — TEE Proof Adapter  
**Estimated time:** ~1.5h  
**Dependencies:** None

---

## Narrative

As a smart contract developer, I need to deploy MockTEEVerifier.sol on Galileo testnet so that development and testing can proceed without requiring real TEE infrastructure.

---

## Acceptance criteria

```gherkin
Given `contracts/MockTEEVerifier.sol` is created with verifyTEESignature(bytes32 dataHash, bytes signature) external view returns (bool)
And the contract compiles with no warnings or errors
When `pnpm hardhat compile` is run
Then the compilation succeeds and generates ABI + bytecode

Given hardhat.config.ts is configured with Galileo testnet (chainId 16602, RPC https://evmrpc-testnet.0g.ai)
And a .env file exists with PRIVATE_KEY for a testnet-funded wallet
When `pnpm hardhat deploy --network zgTestnet --tags mock-tee` is run
Then a contract address is printed to stdout
And the address is saved to `deployments/zgTestnet/MockTEEVerifier.json`
And the file contains { address, abi, transactionHash, blockNumber }

Given a deployed MockTEEVerifier address
When verifyTEESignature() is called with an arbitrary bytes32 hash and signature
Then it returns true (mock behavior: accepts any valid signature)
```

---

## File modification map

**Create:**
- `contracts/MockTEEVerifier.sol` — Solidity contract with verifyTEESignature function
- `contracts/interfaces/ITEEVerifier.sol` — Interface definition
- `scripts/deploy-mock.ts` — Hardhat deployment script
- `hardhat.config.ts` — Hardhat configuration for Galileo testnet

**Update:**
- `.env.example` — Add PRIVATE_KEY, ZG_TESTNET_RPC

---

## Shell verification

```bash
# Compile:
pnpm hardhat compile 2>&1 | grep -i "error" && echo "FAIL" || echo "PASS"

# Deploy:
pnpm hardhat deploy --network zgTestnet --tags mock-tee 2>&1 | grep -oE "0x[a-f0-9]{40}"
# Output must be a valid Ethereum address
```
