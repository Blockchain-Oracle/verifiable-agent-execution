# contracts/ — Solidity (Hardhat)

The two on-chain contracts that anchor every AGENTSCAN receipt.
Compiled with Solidity 0.8.24 (`evmVersion: "cancun"` — required
for 0G Chain, see ADR-09).

## Layout

```
contracts/
├── contracts/                  Solidity source
│   ├── AgenticID.sol           ERC-7857 iNFT — the receipt token
│   ├── MockTEEVerifier.sol     TEE signature verifier (ECDSA-based)
│   └── interfaces/             Interface declarations
├── scripts/                    Deploy + admin scripts
│   ├── deploy-all.ts           Orchestrator — deploys both, writes deployments/<net>/*.json
│   ├── deploy-agenticid.ts     Deploy AgenticID only
│   ├── deploy-mock.ts          Deploy MockTEEVerifier only
│   └── update-oracle.ts        Owner-only TEE oracle rotation
├── test/                       Hardhat + chai contract tests
├── deployments/                Per-network deploy records (gitignored except .gitkeep)
├── hardhat.config.ts           Solidity + network config (testnet + mainnet)
└── tsconfig.json               Strict TS, extends from root
```

## Deployed contracts

### Galileo testnet (chainId 16602)
- **AgenticID** — [`0xd4a5eA…0E38`](https://chainscan-galileo.0g.ai/address/0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38) (block 32602466)
- **MockTEEVerifier** — [`0x058fc3…C3ad`](https://chainscan-galileo.0g.ai/address/0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad) (block 32610650)

### Aristotle mainnet (chainId 16661)
- **AgenticID** — [`0xC6f7fB…8937`](https://chainscan.0g.ai/address/0xC6f7fB1511a7483C6e14258c70529e37ec698937) (block 32907005, 2026-05-11)
- **MockTEEVerifier** — [`0x4fffB5…58D2`](https://chainscan.0g.ai/address/0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2) (block 32907019)

## Common commands

```bash
# Compile + run tests
pnpm --filter contracts run compile
pnpm --filter contracts run test

# Deploy BOTH contracts to testnet (writes contracts/deployments/0g-testnet/*.json)
pnpm --filter contracts run deploy:all:testnet

# Deploy to mainnet (real OG gas — confirm wallet funded first)
pnpm --filter contracts run deploy:all:mainnet

# Rotate the TEE oracle (owner-only)
pnpm --filter contracts exec hardhat run scripts/update-oracle.ts --network 0g-mainnet
```

## Why "MockTEEVerifier"?

Honest naming. The contract verifies an ECDSA signature against a
known TEE oracle public key — it does NOT yet verify a real Intel
TDX/SGX attestation quote. The signing-inside-TEE primitive happens
off-chain (in the plugin); the contract recovers + checks the
signature. Upgrading to a real-attestation verifier is a contract
swap behind the same `verifyTEESignature(bytes32, bytes)` interface.

See [`apps/docs/src/content/concepts.mdx`](../apps/docs/src/content/concepts.mdx)
for the full "TEE-rooted, not trustless" framing.

## Build outputs (gitignored)

- `cache/` — Hardhat compile cache
- `artifacts/` — Compiled contract JSON + bytecode
- `typechain-types/` — TypeChain-generated typed contract interfaces

All three are regenerated on `pnpm --filter contracts run compile`.
