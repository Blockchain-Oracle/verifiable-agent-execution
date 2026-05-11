/**
 * scripts/smoke/signed-anchor.ts
 *
 * One-shot smoke test that mints a session WITH real TEE-shaped
 * signatures so the dashboard's verifier-status flips from "preview"
 * (Mock badge) to "verified" (TEE Verified badge).
 *
 * What it does end-to-end:
 *   1. Builds an ExecutionLogEntry with a real ECDSA signature over
 *      the agent-wrapper signing message digest. The signing wallet
 *      IS the TEE oracle address that MockTEEVerifier was deployed
 *      with — so its signatures pass `verifyTEESignature`.
 *   2. Allocates a SessionLogger, appends the signed entry.
 *   3. Calls SessionAnchor.anchor() — real flush to 0G Storage,
 *      real iMint on AgenticID.
 *   4. Prints the tokenId so you can hit `/verify/<tokenId>` and see
 *      the green "TEE Verified" badge.
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm exec tsx scripts/smoke/signed-anchor.ts
 *
 * Required env (loaded from .env at repo root):
 *   PRIVATE_KEY           — funded wallet (also used as TEE oracle)
 *   ZG_TESTNET_RPC
 *   ZG_TESTNET_INDEXER (or ZG_INDEXER_RPC)
 *   AGENTICID_ADDRESS
 *   TEE_VERIFIER_ADDRESS  — deployed MockTEEVerifier on Galileo
 *
 * The TEE oracle MUST equal the deploy script's TEE_ORACLE_ADDRESS
 * for the signature to verify. We deployed MockTEEVerifier with
 * the same wallet as oracle, so signing with PRIVATE_KEY produces
 * sigs that the verifier accepts.
 */

import { Wallet, JsonRpcProvider, getBytes } from "ethers";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";

import {
  SessionLogger,
  StorageClient,
  type IndexerLike,
} from "@verifiable-agent-execution/logger";
import {
  AgenticIDClient,
  SessionAnchor,
} from "@verifiable-agent-execution/chain-client";
import { signingMessageDigestFromString } from "@verifiable-agent-execution/tee-adapter";

const RPC = process.env.ZG_TESTNET_RPC;
const INDEXER_URL = process.env.ZG_INDEXER_RPC ?? process.env.ZG_TESTNET_INDEXER;
const AGENTICID_ADDRESS = process.env.AGENTICID_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC || !INDEXER_URL || !AGENTICID_ADDRESS || !PRIVATE_KEY) {
  console.error(
    "Missing required env: ZG_TESTNET_RPC, ZG_INDEXER_RPC (or ZG_TESTNET_INDEXER), AGENTICID_ADDRESS, PRIVATE_KEY",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // Early-exit above narrows these at runtime; TS can't carry the
  // narrowing across the function boundary because they're module-
  // scoped. Non-null assertion is safe given the explicit guard.
  const provider = new JsonRpcProvider(RPC);
  const signer = new Wallet(PRIVATE_KEY!, provider);
  console.log(`[signed-anchor] Signer (TEE oracle): ${signer.address}`);

  const network = await provider.getNetwork();
  console.log(`[signed-anchor] Network chainId: ${network.chainId}`);
  if (network.chainId !== 16602n) {
    throw new Error(`Expected Galileo (16602); got ${network.chainId}`);
  }

  // 1. Build a real signed entry.
  // The signing message follows the agent-wrapper convention:
  //   keccak256(`${agentId}|${sealId}|${signedAt}|${bodyHashHex}`)
  // where bodyHashHex is sha256-hex (no 0x prefix) of the body.
  const sessionId = `ses_signed_${Date.now()}`;
  const modelId = "claude-sonnet-4-6";
  const containerHash = `0x${"c".repeat(64)}`;
  const agentId = signer.address; // signer == oracle == bound agent
  const sealId = `0x${"5".repeat(64)}`;
  const signedAt = Math.floor(Date.now() / 1000);
  const inputHash = "a".repeat(64);
  const outputHash = "b".repeat(64);

  const message = `${agentId}|${sealId}|${signedAt}|${outputHash}`;
  const digest = signingMessageDigestFromString(message);
  // signMessage applies EIP-191 prefix; we want the RAW keccak digest
  // signed (matches MockTEEVerifier.verifyTEESignature which
  // recovers the signer from the digest directly without prefix).
  // Use signingKey.sign on the digest bytes.
  const sig = signer.signingKey.sign(digest).serialized;
  console.log(`[signed-anchor] sessionId: ${sessionId}`);
  console.log(`[signed-anchor] signing digest: ${digest}`);
  console.log(`[signed-anchor] signature: ${sig}`);

  // 2. Allocate SessionLogger + StorageClient, append the entry.
  const indexer = new Indexer(INDEXER_URL!);
  const storageClient = new StorageClient({
    rpcUrl: RPC!,
    indexerUrl: INDEXER_URL!,
    signer,
    indexer: indexer as unknown as IndexerLike,
  });
  const logger = new SessionLogger(sessionId, storageClient);
  logger.appendEntry({
    seq: 0,
    ts: Date.now(),
    type: "tool_call",
    tool: "signed-smoke-test",
    inputHash,
    outputHash,
    teeSignature: sig,
    agentId,
    sealId,
    signedAt,
  });

  // 3. Mint via SessionAnchor.
  const agenticIdClient = new AgenticIDClient(AGENTICID_ADDRESS!, provider, signer);
  const anchor = new SessionAnchor(logger, agenticIdClient, agentId, modelId, {
    chainId: 16602,
  });

  const start = Date.now();
  const result = await anchor.anchor({ sessionId, containerHash });
  const elapsed = Date.now() - start;

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("✅ SIGNED ANCHOR SUCCESS");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`tokenId:     ${result.tokenId.toString()}`);
  console.log(`txHash:      ${result.txHash}`);
  console.log(`rootHash:    ${result.rootHash}`);
  console.log(`entryCount:  ${result.entryCount}`);
  console.log(`verifyUrl:   ${result.verifyUrl}`);
  console.log(`elapsed:     ${elapsed}ms`);
  console.log("");
  console.log("Hit the dashboard at:");
  console.log(`  http://localhost:3000${result.verifyUrl}`);
  console.log(
    "Expected: verified=\"verified\" → green TEE Verified badge (because the entry's signature recovers to the deployed verifier's TEE oracle address).",
  );
  console.log("════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("[signed-anchor] FAILED:", err);
  process.exit(1);
});

void getBytes; // suppress unused-import warning if not directly used
