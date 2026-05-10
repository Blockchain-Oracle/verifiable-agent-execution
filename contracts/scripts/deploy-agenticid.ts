// scripts/deploy-agenticid.ts
//
// Deploys AgenticID and writes the deployment record to
// `deployments/<network>/AgenticID.json` so downstream packages
// (chain-client, dashboard, smoke tests) can resolve the address
// without env-var sprawl.
//
// Usage:
//   pnpm hardhat run scripts/deploy-agenticid.ts --network 0g-testnet
//   pnpm hardhat run scripts/deploy-agenticid.ts --network 0g-mainnet
//
// Required env (loaded by hardhat.config.ts from repo-root .env):
//   PRIVATE_KEY=0x... (deployer; must be funded on the target network)
//
// Optional env:
//   AGENTICID_NAME      (default "Agentic ID")
//   AGENTICID_SYMBOL    (default "AID")
//   AGENTICID_MINT_FEE  (default 0; in wei)
//
// Why these defaults: 0G's example AgenticID at
// 0x2700F6A3...EF1F (Galileo testnet) was deployed with name="Agentic ID",
// symbol="AID", mintFee=0. We mirror that so every smoke test that asserts
// `name() == "Agentic ID"` keeps passing. See ADR-08.

import * as fs from "node:fs";
import * as path from "node:path";

import "dotenv/config";
import { ethers, network } from "hardhat";

const DEFAULT_NAME = "Agentic ID";
const DEFAULT_SYMBOL = "AID";
const DEFAULT_MINT_FEE = "0"; // wei

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. Set PRIVATE_KEY in .env at the repo root.",
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy-agenticid] Network: ${network.name}`);
  console.log(`[deploy-agenticid] Deployer: ${deployer.address}`);
  console.log(`[deploy-agenticid] Balance: ${ethers.formatEther(balance)} 0G`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has no balance. Fund it via https://faucet.0g.ai (testnet) " +
        "or transfer 0G on mainnet.",
    );
  }

  const name = process.env.AGENTICID_NAME ?? DEFAULT_NAME;
  const symbol = process.env.AGENTICID_SYMBOL ?? DEFAULT_SYMBOL;
  const mintFeeWei = BigInt(process.env.AGENTICID_MINT_FEE ?? DEFAULT_MINT_FEE);

  console.log(`[deploy-agenticid] Name: ${name}`);
  console.log(`[deploy-agenticid] Symbol: ${symbol}`);
  console.log(`[deploy-agenticid] MintFee: ${mintFeeWei.toString()} wei`);

  const factory = await ethers.getContractFactory("AgenticID");
  const contract = await factory.deploy(name, symbol, mintFeeWei);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log(`[deploy-agenticid] Deployed to: ${address}`);
  console.log(`[deploy-agenticid] Tx:          ${deployTx?.hash ?? "(unknown)"}`);
  console.log(`[deploy-agenticid] Block:       ${receipt?.blockNumber ?? "(unknown)"}`);

  const artifactPath = path.resolve(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "AgenticID.sol",
    "AgenticID.json",
  );
  const artifactJson = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
    abi: unknown;
  };

  const outDir = path.resolve(__dirname, "..", "deployments", network.name);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "AgenticID.json");
  const record = {
    address,
    abi: artifactJson.abi,
    transactionHash: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number(network.config.chainId ?? 0),
    constructorArgs: { name, symbol, mintFee: mintFeeWei.toString() },
  };
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[deploy-agenticid] Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
