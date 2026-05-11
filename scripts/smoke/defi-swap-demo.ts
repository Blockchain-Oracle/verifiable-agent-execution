/**
 * scripts/smoke/defi-swap-demo.ts
 *
 * Mints THE demo session: a 4-step autonomous DeFi swap simulator
 * that quotes, checks liquidity, simulates the swap, and asks a human
 * for final approval. Each step has:
 *   - Full decoded params + result (Stage 3 — the dashboard renders
 *     the actual story, not just hashes)
 *   - Real TEE signature from the wallet that IS the deployed
 *     MockTEEVerifier's oracle (so verified="verified" → green badge)
 *   - Realistic agent-wrapper attestation fields (agentId, sealId,
 *     signedAt) so the dashboard's verifyTEESignature contract call
 *     succeeds end-to-end
 *
 * This replaces tokenId 97's fake `signed-smoke-test` entry as the
 * canonical demo asset. Per ADR-11 reverse demo: judge gets the
 * URL cold → sees a recognizable DeFi swap arc → clicks Verify
 * → all 4 badges flip green.
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm exec tsx scripts/smoke/defi-swap-demo.ts
 *
 * Required env (from .env):
 *   PRIVATE_KEY            — funded wallet (also = TEE oracle)
 *   ZG_TESTNET_RPC, ZG_TESTNET_INDEXER (or ZG_INDEXER_RPC)
 *   AGENTICID_ADDRESS
 */

import { Wallet, JsonRpcProvider } from "ethers";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";

import {
  SessionLogger,
  StorageClient,
  type ExecutionLogEntry,
  type IndexerLike,
} from "@verifiable-agent-execution/logger";
import {
  AgenticIDClient,
  SessionAnchor,
} from "@verifiable-agent-execution/chain-client";
import { signingMessageDigestFromString } from "@verifiable-agent-execution/tee-adapter";

import { createHash } from "node:crypto";

// ZG_RPC is the canonical env name (network-agnostic — value differs
// for testnet vs mainnet runs). ZG_TESTNET_RPC kept as a fallback for
// .env files written pre-Epic-7.
const RPC = process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai";
const INDEXER_URL =
  process.env.ZG_INDEXER_RPC ??
  process.env.ZG_TESTNET_INDEXER ??
  "https://indexer-storage-testnet-turbo.0g.ai";
const AGENTICID_ADDRESS =
  process.env.AGENTICID_ADDRESS ?? "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("PRIVATE_KEY env required (must equal MockTEEVerifier's oracle)");
  process.exit(1);
}

const MODEL_ID = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// The 4-step DeFi swap arc — params + result for each tool call.
// Realistic enough that a judge reading the proof immediately
// understands "an agent simulated a USDC→ETH swap and asked for
// human approval." The numbers are believable but synthetic — no
// real on-chain DEX call required for the demo asset.
// ---------------------------------------------------------------------------

interface SwapStep {
  tool: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  delayMs: number;
}

/**
 * Build the 4-step DeFi swap arc with `operatorAddress` threaded from
 * the actual signer. Previously the operator field was a fixed literal
 * `0x3b56…33A3` which made the anchored proof falsely claim approval
 * from one specific wallet regardless of who actually ran the script.
 * Mirrors the fix already applied to defi-swap-demo-with-compute.ts.
 * (Codex bot round-11 P2 on PR #23.)
 */
function buildSwapSteps(operatorAddress: string): SwapStep[] {
  return [
  {
    tool: "quote",
    params: { from: "USDC", to: "ETH", amount: 1000, slippageMaxBps: 50 },
    result: {
      rateUsdcPerEth: 2380.42,
      ethOut: 0.42,
      priceImpactBps: 8,
      route: ["USDC", "WETH"],
      quotedAt: "2026-05-06T10:14:32Z",
    },
    delayMs: 120,
  },
  {
    tool: "liquidity",
    params: { pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", asset: "USDC" },
    result: {
      poolName: "Uniswap V3 USDC/WETH 0.3%",
      depthUsd: 1_237_842.55,
      slippageAtSize: 0.42,
      sufficientForSize: true,
      observedAt: "2026-05-06T10:14:33Z",
    },
    delayMs: 180,
  },
  {
    tool: "simulate-swap",
    params: { from: "USDC", to: "ETH", amount: 1000, slippageBps: 50, gasLimit: 200000 },
    result: {
      executed: true,
      gasUsed: 142_311,
      gasPriceGwei: 0.05,
      ethOut: 0.4198,
      slippageActualBps: 5,
      simulatedAt: "2026-05-06T10:14:34Z",
    },
    delayMs: 220,
  },
  {
    tool: "final-approval",
    params: {
      operatorAddress,
      proposedSwap: { from: "USDC", to: "ETH", amount: 1000 },
      reason: "Above $500 threshold — human approval required",
    },
    result: {
      approved: false,
      reason: "Demo mode — no live execution; returning safe-no",
      approvalRequestedAt: "2026-05-06T10:14:35Z",
    },
    delayMs: 90,
  },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256HexNoPrefix(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value), "utf8")
    .digest("hex");
}

function signEntry(opts: {
  signer: Wallet;
  agentId: string;
  sealId: string;
  signedAt: number;
  outputHash: string;
}): string {
  // agent-wrapper signing convention: keccak256(`agentId|sealId|signedAt|bodyHashHex`)
  // signed RAW (no EIP-191 prefix). MockTEEVerifier.verifyTEESignature recovers
  // the signer from the digest directly.
  const message = `${opts.agentId}|${opts.sealId}|${opts.signedAt}|${opts.outputHash}`;
  const digest = signingMessageDigestFromString(message);
  return opts.signer.signingKey.sign(digest).serialized;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const provider = new JsonRpcProvider(RPC);
  const signer = new Wallet(PRIVATE_KEY!, provider);
  console.log(`[defi-swap-demo] Signer (TEE oracle): ${signer.address}`);

  const network = await provider.getNetwork();
  if (network.chainId !== 16602n) {
    throw new Error(`Expected Galileo (16602); got ${network.chainId}`);
  }
  console.log(`[defi-swap-demo] Galileo chainId confirmed: 16602`);

  const sessionId = `ses_defi_swap_${Date.now()}`;
  const containerHash = `0x${"d".repeat(64)}`;
  const agentId = signer.address;

  // Build storage + agenticID clients.  Demo runs sometimes hit
  // testnet indexer sync latency > 30s — the SessionLogger's BDD
  // upload bound rejects too aggressively for live demo mints.  Allow
  // STORAGE_UPLOAD_TIMEOUT_MS env override (default 120s for demo
  // scripts vs the 30s BDD ceiling for production code paths).
  const uploadTimeoutMs = Number(
    process.env.STORAGE_UPLOAD_TIMEOUT_MS ?? "120000",
  );
  const indexer = new Indexer(INDEXER_URL);
  const storageClient = new StorageClient({
    rpcUrl: RPC,
    indexerUrl: INDEXER_URL,
    signer,
    indexer: indexer as unknown as IndexerLike,
    uploadTimeoutMs,
  });
  console.log(`[defi-swap-demo] StorageClient uploadTimeoutMs=${uploadTimeoutMs}`);
  const logger = new SessionLogger(sessionId, storageClient);

  // Append all 4 signed entries with FULL DECODED CONTENT. Build
  // SWAP_STEPS NOW with the actual signer.address threaded into the
  // final-approval step's operatorAddress so the anchored proof
  // reflects whoever ran the script — not one specific wallet.
  const swapSteps = buildSwapSteps(signer.address);
  let baseTs = Date.now();
  for (let i = 0; i < swapSteps.length; i++) {
    const step = swapSteps[i]!;
    baseTs += step.delayMs;
    const inputHash = sha256HexNoPrefix(step.params);
    const outputHash = sha256HexNoPrefix(step.result);
    const sealId = `0x${(i + 1).toString().padStart(64, "0")}`;
    const signedAt = Math.floor(baseTs / 1000);

    const teeSignature = signEntry({
      signer,
      agentId,
      sealId,
      signedAt,
      outputHash,
    });

    const entry: ExecutionLogEntry = {
      seq: i,
      ts: baseTs,
      type: "tool_call",
      tool: step.tool,
      inputHash,
      outputHash,
      teeSignature,
      agentId,
      sealId,
      signedAt,
      // Stage 3: decoded content — what makes the dashboard "Etherscan"
      params: step.params,
      result: step.result,
    };
    logger.appendEntry(entry);
    console.log(`[defi-swap-demo] seq #${i} ${step.tool} appended (signed)`);
  }

  // Mint via SessionAnchor
  const agenticIdClient = new AgenticIDClient(AGENTICID_ADDRESS, provider, signer);
  const anchor = new SessionAnchor(logger, agenticIdClient, agentId, MODEL_ID, {
    chainId: 16602,
  });

  console.log(`[defi-swap-demo] Anchoring session...`);
  const start = Date.now();
  const result = await anchor.anchor({ sessionId, containerHash });
  const elapsed = Date.now() - start;

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("✅ DEFI SWAP DEMO SESSION ANCHORED");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`  tokenId:     ${result.tokenId.toString()}`);
  console.log(`  txHash:      ${result.txHash}`);
  console.log(`  rootHash:    ${result.rootHash}`);
  console.log(`  entryCount:  ${result.entryCount}`);
  console.log(`  verifyUrl:   ${result.verifyUrl}`);
  console.log(`  elapsed:     ${elapsed}ms`);
  console.log("");
  console.log("  Dashboard (local dev):");
  console.log(`    http://localhost:3000/verify/${result.tokenId.toString()}`);
  console.log("");
  console.log("  Expected proof page:");
  console.log("    • Session header (sessionId, agent, model, 4 entries)");
  console.log("    • Status: 🟢 TEE Verified (all 4 sigs recover to oracle)");
  console.log("    • Per-step decoded story:");
  for (const step of swapSteps) {
    const paramSummary = JSON.stringify(step.params).slice(0, 60);
    console.log(`        ${step.tool}: ${paramSummary}...`);
  }
  console.log("════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("[defi-swap-demo] FAILED:", err);
  process.exit(1);
});
