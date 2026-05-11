// scripts/deploy-all.ts
//
// Orchestrator: deploys AgenticID + MockTEEVerifier in one go and
// writes both deployment records under `deployments/<network>/`.
//
// Usage:
//   pnpm hardhat run scripts/deploy-all.ts --network 0g-testnet
//   pnpm hardhat run scripts/deploy-all.ts --network 0g-mainnet
//
// Required env: PRIVATE_KEY (deployer wallet — must be funded on the
// target network). Optional env: TEE_ORACLE_ADDRESS (overrides the
// canonical 0G TEE oracle for MockTEEVerifier construction; useful when
// the demo wallet is acting as the oracle for a self-contained mainnet
// demo).
//
// Order matters: AgenticID first (its address goes into the dashboard's
// AGENTICID_ADDRESS env), then MockTEEVerifier (its address goes into
// TEE_VERIFIER_ADDRESS). The two contracts have no on-chain dependency
// on each other — the dashboard composes them off-chain.

import * as fs from "node:fs";
import * as path from "node:path";

import "dotenv/config";
import { ethers, network } from "hardhat";

// When TEE_ORACLE_ADDRESS is unset, use the deployer's own address as the
// oracle. This is the demo-friendly default: signatures the deployer's
// wallet produces will recover to itself, so MockTEEVerifier.verifyTEE
// Signature(...) returns true. Production / agent-wrapper integration
// can override with the real TEE seal-key address. Mirrors what the
// historical testnet MockTEEVerifier (0x6F96f3...8E8CE) was deployed
// with — see the existing deployments/0g-testnet/MockTEEVerifier.json.
const DEFAULT_AGENTICID_NAME = "Agentic ID";
const DEFAULT_AGENTICID_SYMBOL = "AID";
const DEFAULT_AGENTICID_MINT_FEE = "0";

interface DeploymentRecord {
  address: string;
  abi: unknown;
  transactionHash: string | null;
  blockNumber: number | null;
  chainId: number;
  [k: string]: unknown;
}

function loadAbi(contractName: string): unknown {
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifactJson = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
    abi: unknown;
  };
  return artifactJson.abi;
}

function writeRecord(contractName: string, record: DeploymentRecord): string {
  const outDir = path.resolve(__dirname, "..", "deployments", network.name);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${contractName}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  return outPath;
}

async function deployAgenticID(): Promise<DeploymentRecord> {
  const name = process.env.AGENTICID_NAME ?? DEFAULT_AGENTICID_NAME;
  const symbol = process.env.AGENTICID_SYMBOL ?? DEFAULT_AGENTICID_SYMBOL;
  const mintFeeWei = BigInt(
    process.env.AGENTICID_MINT_FEE ?? DEFAULT_AGENTICID_MINT_FEE,
  );

  console.log("[deploy-all] === AgenticID ===");
  console.log(`[deploy-all]   name=${name} symbol=${symbol} mintFee=${mintFeeWei}`);

  const factory = await ethers.getContractFactory("AgenticID");
  const contract = await factory.deploy(name, symbol, mintFeeWei);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log(`[deploy-all]   AgenticID @ ${address}`);
  console.log(`[deploy-all]   tx=${deployTx?.hash ?? "(unknown)"} block=${receipt?.blockNumber ?? "(unknown)"}`);

  return {
    address,
    abi: loadAbi("AgenticID"),
    transactionHash: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number(network.config.chainId ?? 0),
    constructorArgs: { name, symbol, mintFee: mintFeeWei.toString() },
  };
}

async function deployMockTEEVerifier(deployerAddress: string): Promise<DeploymentRecord> {
  const oracle = process.env.TEE_ORACLE_ADDRESS ?? deployerAddress;

  console.log("[deploy-all] === MockTEEVerifier ===");
  console.log(`[deploy-all]   teeOracleAddress=${oracle}${oracle === deployerAddress ? " (deployer)" : ""}`);

  const factory = await ethers.getContractFactory("MockTEEVerifier");
  const contract = await factory.deploy(oracle);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log(`[deploy-all]   MockTEEVerifier @ ${address}`);
  console.log(`[deploy-all]   tx=${deployTx?.hash ?? "(unknown)"} block=${receipt?.blockNumber ?? "(unknown)"}`);

  return {
    address,
    abi: loadAbi("MockTEEVerifier"),
    transactionHash: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number(network.config.chainId ?? 0),
    teeOracleAddress: oracle,
  };
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. Set PRIVATE_KEY in .env at the repo root.",
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy-all] Network: ${network.name}`);
  console.log(`[deploy-all] Deployer: ${deployer.address}`);
  console.log(`[deploy-all] Balance: ${ethers.formatEther(balance)} 0G`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has no balance. Fund it via https://faucet.0g.ai (testnet) " +
        "or transfer 0G on mainnet.",
    );
  }

  const agenticIdRecord = await deployAgenticID();
  const verifierRecord = await deployMockTEEVerifier(deployer.address);

  const agenticIdPath = writeRecord("AgenticID", agenticIdRecord);
  const verifierPath = writeRecord("MockTEEVerifier", verifierRecord);

  console.log("");
  console.log("[deploy-all] === Summary ===");
  console.log(`[deploy-all]   AgenticID:        ${agenticIdRecord.address}`);
  console.log(`[deploy-all]   MockTEEVerifier:  ${verifierRecord.address}`);
  console.log(`[deploy-all]   Saved: ${agenticIdPath}`);
  console.log(`[deploy-all]   Saved: ${verifierPath}`);
  console.log("");
  console.log("[deploy-all] Next: dashboard env overrides for THIS network:");
  console.log(`[deploy-all]   AGENTICID_ADDRESS=${agenticIdRecord.address}`);
  console.log(`[deploy-all]   TEE_VERIFIER_ADDRESS=${verifierRecord.address}`);
  console.log(`[deploy-all]   CHAIN_ID=${agenticIdRecord.chainId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
