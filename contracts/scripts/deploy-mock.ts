// scripts/deploy-mock.ts
//
// Deploys MockTEEVerifier and writes the deployment record to
// `deployments/<network>/MockTEEVerifier.json` so downstream packages can
// resolve the address without env-var sprawl.
//
// Usage:
//   pnpm hardhat run scripts/deploy-mock.ts --network 0g-testnet
//   pnpm hardhat run scripts/deploy-mock.ts --network 0g-mainnet
//
// Requires PRIVATE_KEY in .env (already gitignored at repo root).
//
// The default oracle address points at the canonical 0G TEE oracle
// (`0x04581d…`). Override with `TEE_ORACLE_ADDRESS=<addr>` for
// integration tests where a known test wallet must produce valid sigs.

import * as fs from "node:fs";
import * as path from "node:path";

import "dotenv/config";
import { ethers, network } from "hardhat";

const DEFAULT_ORACLE = "0x04581d192d22510ced643eaced12ef169644811a";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. Set PRIVATE_KEY in .env at the repo root.",
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy-mock] Network: ${network.name}`);
  console.log(`[deploy-mock] Deployer: ${deployer.address}`);
  console.log(`[deploy-mock] Balance: ${ethers.formatEther(balance)} 0G`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has no balance. Fund it via https://faucet.0g.ai (testnet) " +
        "or transfer 0G on mainnet.",
    );
  }

  const oracle = process.env.TEE_ORACLE_ADDRESS ?? DEFAULT_ORACLE;
  console.log(`[deploy-mock] TEE oracle: ${oracle}`);

  const factory = await ethers.getContractFactory("MockTEEVerifier");
  const contract = await factory.deploy(oracle);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log(`[deploy-mock] Deployed to: ${address}`);
  console.log(`[deploy-mock] Tx:          ${deployTx?.hash ?? "(unknown)"}`);
  console.log(`[deploy-mock] Block:       ${receipt?.blockNumber ?? "(unknown)"}`);

  // Persist the deployment record. ABI is read from the artifact JSON
  // synchronously so the script doesn't need ESM dynamic imports
  // (contracts package runs CommonJS for Hardhat compatibility).
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "MockTEEVerifier.sol",
    "MockTEEVerifier.json",
  );
  const artifactJson = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
    abi: unknown;
  };

  const outDir = path.resolve(__dirname, "..", "deployments", network.name);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "MockTEEVerifier.json");
  const record = {
    address,
    abi: artifactJson.abi,
    transactionHash: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number(network.config.chainId ?? 0),
    teeOracleAddress: oracle,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[deploy-mock] Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
