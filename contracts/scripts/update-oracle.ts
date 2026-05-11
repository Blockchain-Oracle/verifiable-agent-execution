// scripts/update-oracle.ts
//
// Rotates the MockTEEVerifier's `teeOracleAddress` to a new address.
// Requires the caller to be the contract OWNER (the original deployer).
//
// Usage:
//   pnpm hardhat run scripts/update-oracle.ts --network 0g-mainnet
//   pnpm hardhat run scripts/update-oracle.ts --network 0g-testnet
//
// Reads:
//   - VERIFIER_ADDRESS env (or falls back to deployments/<network>/MockTEEVerifier.json)
//   - NEW_ORACLE_ADDRESS env (or falls back to the deployer's own address)
//
// Why this exists: deploy-all.ts respects TEE_ORACLE_ADDRESS env if set,
// so a `.env` carrying the canonical 0G oracle (`0x04581d…811a`) wires
// the verifier to that address. Our demo signs with the deployer wallet
// and needs `verifyTEESignature` to recover to that wallet — so we
// rotate the oracle to deployer.address with one onlyOwner tx.

import * as fs from "node:fs";
import * as path from "node:path";

import "dotenv/config";
import { ethers, network } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer available. Set PRIVATE_KEY in .env at the repo root.");
  }

  // Resolve the verifier address — env override > deployments/<network>/MockTEEVerifier.json.
  let verifierAddress = process.env.VERIFIER_ADDRESS ?? "";
  if (!verifierAddress) {
    const deploymentPath = path.resolve(
      __dirname,
      "..",
      "deployments",
      network.name,
      "MockTEEVerifier.json",
    );
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(
        `No deployment found at ${deploymentPath}. Set VERIFIER_ADDRESS env or deploy first.`,
      );
    }
    const record = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as {
      address: string;
    };
    verifierAddress = record.address;
  }

  const newOracle = process.env.NEW_ORACLE_ADDRESS ?? deployer.address;

  console.log(`[update-oracle] Network:        ${network.name}`);
  console.log(`[update-oracle] Verifier:       ${verifierAddress}`);
  console.log(`[update-oracle] Caller (owner): ${deployer.address}`);
  console.log(`[update-oracle] New oracle:     ${newOracle}${newOracle === deployer.address ? " (deployer)" : ""}`);

  const verifier = await ethers.getContractAt(
    "MockTEEVerifier",
    verifierAddress,
    deployer,
  );

  const currentOracle = (await (verifier as unknown as {
    teeOracleAddress: () => Promise<string>;
  }).teeOracleAddress()) as string;
  console.log(`[update-oracle] Current oracle: ${currentOracle}`);

  let onChainOracle = currentOracle;
  if (currentOracle.toLowerCase() === newOracle.toLowerCase()) {
    console.log("[update-oracle] On-chain oracle already matches — skipping tx.");
  } else {
    const tx = await (verifier as unknown as {
      updateOracleAddress: (
        addr: string,
      ) => Promise<import("ethers").ContractTransactionResponse>;
    }).updateOracleAddress(newOracle);
    console.log(`[update-oracle] Tx sent:        ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[update-oracle] Tx confirmed in block ${receipt?.blockNumber ?? "(unknown)"}`);

    onChainOracle = (await (verifier as unknown as {
      teeOracleAddress: () => Promise<string>;
    }).teeOracleAddress()) as string;
    console.log(`[update-oracle] New oracle on-chain: ${onChainOracle}`);
  }

  // ALWAYS reconcile the deployment record with the on-chain oracle
  // (even when no tx was sent). The no-op-on-tx path used to skip this
  // step, which left local JSON state stale whenever someone re-ran the
  // script after a successful rotation — Codex caught it on PR #23.
  // Idempotency rule: after this script returns successfully,
  // deployments/<network>/MockTEEVerifier.json.teeOracleAddress MUST
  // match the live on-chain teeOracleAddress() value.
  const deploymentPath = path.resolve(
    __dirname,
    "..",
    "deployments",
    network.name,
    "MockTEEVerifier.json",
  );
  if (!fs.existsSync(deploymentPath)) {
    console.log(`[update-oracle] No deployment record at ${deploymentPath} — skipping JSON sync.`);
    return;
  }
  const record = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Record<string, unknown>;
  const recordOracle = typeof record.teeOracleAddress === "string" ? record.teeOracleAddress : "";
  if (recordOracle.toLowerCase() === onChainOracle.toLowerCase()) {
    console.log(`[update-oracle] Deployment record already in sync: ${deploymentPath}`);
    return;
  }
  record.teeOracleAddress = onChainOracle;
  fs.writeFileSync(deploymentPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`[update-oracle] Reconciled deployment record (${recordOracle || "<missing>"} → ${onChainOracle}): ${deploymentPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
