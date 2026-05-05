// hardhat.config.ts — verifiable-agent-execution contracts
//
// Source of truth: 0gfoundation/0g-agent-skills/patterns/CHAIN.md
// Critical: `evmVersion: "cancun"` is REQUIRED for 0G Chain. Without it,
// contracts using OpenZeppelin's ECDSA.recover deploy successfully and
// REVERT at runtime with "invalid opcode". See ADR-09.
//
// Networks named per the patterns doc convention (0g-testnet / 0g-mainnet)
// so deploy invocations match: `hardhat run scripts/... --network 0g-testnet`.

import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // REQUIRED — see ADR-09 / agent-skills/patterns/CHAIN.md.
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    "0g-testnet": {
      url: process.env.ZG_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai",
      chainId: 16602,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    "0g-mainnet": {
      url: process.env.ZG_MAINNET_RPC ?? "https://evmrpc.0g.ai",
      chainId: 16661,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
