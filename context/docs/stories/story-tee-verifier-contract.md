# Story: tee-verifier-contract

**Epic:** Epic 2 — TEE Proof Adapter
**Estimated time:** ~1.5h
**Dependencies:** None

---

## Narrative

As a smart contract developer, I need to deploy a `MockTEEVerifier.sol` on 0G Galileo testnet that exposes the canonical `verifyTEESignature(bytes32, bytes) → bool` interface so the TEE adapter can submit `(dataHash, signature)` pairs and verify them on-chain during dev.

**Source of truth:**
- Real production verifier: `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol` (uses OZ `ECDSA.recover`, requires `signature.length == 65`, compares recovered signer to a stored `teeOracleAddress`).
- Default oracle address: `0x04581d192d22510ced643eaced12ef169644811a` (hardcoded in `0gfoundation/0g-agent-nft/scripts/deploy/deploy_tee.ts`, verified).
- Chain patterns: `0gfoundation/0g-agent-skills/patterns/CHAIN.md` — **`evmVersion: "cancun"` is REQUIRED**. Without it the contract deploys but reverts at runtime with "invalid opcode."
- Network names: use `0g-testnet` (chainId 16602) and `0g-mainnet` (chainId 16661) per the patterns doc.

---

## Acceptance criteria

```gherkin
Given `contracts/MockTEEVerifier.sol` is created with:
  - function verifyTEESignature(bytes32 dataHash, bytes calldata signature) external view returns (bool)
  - signature.length == 65 require check
  - either accepts any 65-byte sig (true mock) OR delegates to ECDSA.recover with a configurable oracle address

Given `hardhat.config.ts` is configured with:
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' }  // REQUIRED
  }
And networks include:
  '0g-testnet': { url: 'https://evmrpc-testnet.0g.ai', chainId: 16602, accounts: [PRIVATE_KEY] }
  '0g-mainnet': { url: 'https://evmrpc.0g.ai',          chainId: 16661, accounts: [PRIVATE_KEY] }

When `pnpm hardhat compile` is run
Then it succeeds with no warnings
And the produced bytecode is generated for evmVersion "cancun"

When `pnpm hardhat run scripts/deploy-mock.ts --network 0g-testnet` is run
Then a contract address is printed
And the address is saved to `deployments/0g-testnet/MockTEEVerifier.json`
And the file contains { address, abi, transactionHash, blockNumber }

Given the deployed MockTEEVerifier address
And a 65-byte ECDSA signature over an arbitrary bytes32 hash
When verifyTEESignature(hash, sig) is called via eth_call (no gas)
Then it returns true (or correctly recovers the configured oracle address)
And does NOT revert with "invalid opcode" (proof that evmVersion is correct)

Given a signature whose length != 65
When verifyTEESignature is called
Then it reverts with "Invalid signature length" (matches the production TeeVerifier require)
```

---

## File modification map

**Create:**
- `contracts/MockTEEVerifier.sol` — Solidity 0.8.24, mirrors production `TeeVerifier.sol` interface.
- `contracts/interfaces/ITEEVerifier.sol` — `interface ITEEVerifier { function verifyTEESignature(bytes32, bytes calldata) external view returns (bool); }`
- `scripts/deploy-mock.ts` — Hardhat deployment, prints address + writes deployments JSON.
- `hardhat.config.ts` — with `evmVersion: "cancun"` and the two named networks above.

**Update:**
- `.env.example` — `PRIVATE_KEY=`, `RPC_URL=https://evmrpc-testnet.0g.ai`, `CHAIN_ID=16602`.
- `package.json` (root or `contracts/` workspace) — `hardhat`, `@nomicfoundation/hardhat-toolbox`, `@openzeppelin/contracts` as deps.

---

## Shell verification

```bash
pnpm hardhat compile 2>&1 | grep -iE "(error|warning|cancun)"
# Should print "evmVersion=cancun" or similar; must NOT print errors.

# Deploy:
pnpm hardhat run scripts/deploy-mock.ts --network 0g-testnet 2>&1 | grep -oE "0x[a-fA-F0-9]{40}"
# Must print a valid Ethereum address.

# Smoke against deployed contract:
cast call <DEPLOYED_ADDRESS> "verifyTEESignature(bytes32,bytes)" \
  0x0000000000000000000000000000000000000000000000000000000000000001 \
  0x<65-byte-hex-sig> \
  --rpc-url https://evmrpc-testnet.0g.ai
# Should return 0x...01 (true), not revert.
```

---

## Notes for the coding agent

- **`evmVersion: "cancun"` is non-negotiable.** OZ `ECDSA.recover` uses opcodes only available in cancun on 0G Chain. Skipping this produces a contract that deploys fine and reverts at runtime — exactly the kind of late-discovered failure we are explicitly trying to avoid.
- **Mirror the production `TeeVerifier.sol` interface** even for the mock — when we promote to mainnet we want the call sites unchanged. Only the verification body (`recover` vs accept-any) should differ.
- **Required test case:** signature length not 65 must revert with the same string as the production contract (`"Invalid signature length"`). This makes integration tests portable between mock and real.
- **Deployment-output convention:** save `{address, abi, transactionHash, blockNumber}` to `deployments/0g-testnet/MockTEEVerifier.json` — this is the standard hardhat-deploy plugin shape and downstream packages can read it without bespoke wiring.
- **Reference reading order:** `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol` → `0gfoundation/0g-agent-skills/patterns/CHAIN.md` → this story.
