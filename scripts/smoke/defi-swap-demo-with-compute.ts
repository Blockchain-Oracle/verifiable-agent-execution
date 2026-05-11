/**
 * scripts/smoke/defi-swap-demo-with-compute.ts
 *
 * The "depth" demo session: the SAME 4-step DeFi swap arc as
 * `defi-swap-demo.ts`, plus a REAL inference call through 0G Compute
 * Network as seq 0. Anchors against the Epic-7 fresh contracts
 * (AgenticID + MockTEEVerifier we deployed ourselves) so judges see
 * end-to-end ownership of the verifiable-execution primitive on 0G.
 *
 * What's new vs defi-swap-demo.ts:
 *   - One REAL HTTP call to a 0G Compute provider (TeeML model on
 *     Galileo testnet) BEFORE the deterministic tool calls. The
 *     provider's response IS the agent's "decision" to proceed with
 *     the swap. Captured as a `type: "inference"` log entry with
 *     model + provider + endpoint + usage + cost in `result`.
 *   - Bootstrap is idempotent: tries to acknowledge the provider on
 *     every run; swallows "already acknowledged" errors so the script
 *     remains rerunnable for demo purposes.
 *   - All entries (inference + 4 tool calls) are signed with the
 *     deployer wallet, which IS the new MockTEEVerifier's
 *     teeOracleAddress (deployed 2026-05-10 with TEE_ORACLE_ADDRESS
 *     set to deployer.address).
 *
 * Run:
 *   set -a && source .env && set +a
 *   AGENTICID_ADDRESS=0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38 \
 *   TEE_VERIFIER_ADDRESS=0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad \
 *   pnpm exec tsx scripts/smoke/defi-swap-demo-with-compute.ts
 *
 * Required env:
 *   PRIVATE_KEY            — funded wallet (also = TEE oracle on the
 *                            new verifier). Must have >= 0.001 0G for
 *                            broker.ledger.depositFund + provider
 *                            transferFund + iMint gas.
 *   ZG_TESTNET_RPC, ZG_TESTNET_INDEXER (or ZG_INDEXER_RPC)
 *   AGENTICID_ADDRESS      — Epic-7 testnet AgenticID
 *
 * Optional:
 *   COMPUTE_PROVIDER_ADDRESS — pin a specific 0G Compute provider
 *     address. When unset, the script picks the first listed provider
 *     for `qwen-2.5-7b-instruct` (the canonical Galileo testnet
 *     chatbot model per context/02-sponsor-docs.md).
 *   COMPUTE_DEPOSIT_OG       — main-account deposit amount (default
 *     "0.001"). Per-call inference cost is on the order of 1e-5 0G
 *     for ~300 tokens, so 0.001 covers >100 demo runs.
 */

import { Wallet, JsonRpcProvider } from "ethers";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

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

// ---------------------------------------------------------------------------
// Env + defaults
// ---------------------------------------------------------------------------

const RPC = process.env.ZG_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai";
const INDEXER_URL =
  process.env.ZG_INDEXER_RPC ??
  process.env.ZG_TESTNET_INDEXER ??
  "https://indexer-storage-testnet-turbo.0g.ai";
const AGENTICID_ADDRESS =
  process.env.AGENTICID_ADDRESS ?? "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PINNED_PROVIDER = process.env.COMPUTE_PROVIDER_ADDRESS ?? "";
// 0G Compute Ledger contract enforces MIN_LEDGER_BALANCE_OG = 3 to
// CREATE a ledger account; the SDK then auto-transfers 2 0G per
// provider sub-account on first inference. Default 4 covers both
// (ledger 3 + sub-account 2 = 5 — but sub-account auto-funding draws
// from the just-deposited ledger, not the wallet, so 4 suffices for
// initial setup). Override to 3 once the ledger exists for top-ups.
// Funds remain recoverable via `0g-compute-cli retrieve-fund` (24h lock).
const DEPOSIT_OG = Number(process.env.COMPUTE_DEPOSIT_OG ?? "4");

if (!PRIVATE_KEY) {
  console.error(
    "[demo-compute] PRIVATE_KEY env required (must equal MockTEEVerifier oracle)",
  );
  process.exit(1);
}

const MODEL_ID_LOG = "0g-compute/qwen-2.5-7b-instruct";

// ---------------------------------------------------------------------------
// The 4-step DeFi swap arc — params + result for each tool call.
// (Same as defi-swap-demo.ts; copied here so this script is
// self-contained and the two demos can diverge independently.)
// ---------------------------------------------------------------------------

const SWAP_STEPS: Array<{
  tool: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  delayMs: number;
}> = [
  {
    tool: "quote",
    params: { from: "USDC", to: "ETH", amount: 1000, slippageMaxBps: 50 },
    result: {
      rateUsdcPerEth: 2380.42,
      ethOut: 0.42,
      priceImpactBps: 8,
      route: ["USDC", "WETH"],
      quotedAt: new Date().toISOString(),
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
      observedAt: new Date().toISOString(),
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
      simulatedAt: new Date().toISOString(),
    },
    delayMs: 220,
  },
  {
    tool: "final-approval",
    params: {
      operatorAddress: "0x3b566583b51DA4da8d95565212C96836f66433A3",
      proposedSwap: { from: "USDC", to: "ETH", amount: 1000 },
      reason: "Above $500 threshold — human approval required",
    },
    result: {
      approved: false,
      reason: "Demo mode — no live execution; returning safe-no",
      approvalRequestedAt: new Date().toISOString(),
    },
    delayMs: 90,
  },
];

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
  const message = `${opts.agentId}|${opts.sealId}|${opts.signedAt}|${opts.outputHash}`;
  const digest = signingMessageDigestFromString(message);
  return opts.signer.signingKey.sign(digest).serialized;
}

interface ComputeInferenceResult {
  providerAddress: string;
  endpoint: string;
  modelName: string;
  verificationType: string;
  prompt: string;
  responseText: string;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  rawResponse: unknown;
}

/**
 * Bootstrap + invoke a 0G Compute provider once. Idempotent — safe to
 * re-run between demos. Returns the raw inference response plus the
 * provider/endpoint/model metadata that gets pinned into the log
 * entry's `result` field.
 *
 * Bootstrap steps (each soft-failing on "already done"):
 *   1. Init broker via createZGComputeNetworkBroker(wallet)
 *   2. Best-effort `ledger.depositFund(DEPOSIT_OG)` — ignored if
 *      already funded above threshold
 *   3. Pick provider — pinned via COMPUTE_PROVIDER_ADDRESS or first
 *      listed (we filter to qwen-2.5-7b-instruct)
 *   4. acknowledgeProviderSigner — swallows "already acknowledged"
 *   5. getServiceMetadata + getRequestHeaders + fetch
 */
async function callComputeProvider(opts: {
  signer: Wallet;
  prompt: string;
}): Promise<ComputeInferenceResult> {
  console.log("[demo-compute] === 0G Compute bootstrap ===");
  const broker = await createZGComputeNetworkBroker(opts.signer);

  // Step 1 — fund main account if needed. depositFund throws if account
  // is already > some threshold; we swallow to keep idempotent.
  try {
    console.log(`[demo-compute]   ledger.depositFund(${DEPOSIT_OG})`);
    await broker.ledger.depositFund(DEPOSIT_OG);
    console.log("[demo-compute]   deposit OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[demo-compute]   deposit skipped/failed: ${msg.slice(0, 120)}`);
  }

  // Step 2 — find provider. Pinned first; otherwise list + pick first
  // entry whose model is qwen-2.5-7b-instruct.
  let providerAddress = PINNED_PROVIDER;
  let modelName = "qwen-2.5-7b-instruct";
  let verificationType = "TeeML";
  if (!providerAddress) {
    console.log("[demo-compute]   listing providers…");
    const services = await broker.inference.listService();
    console.log(`[demo-compute]   found ${services.length} providers`);
    for (const svc of services as Array<{
      provider?: string;
      providerAddress?: string;
      model?: string;
      verifiability?: string;
    }>) {
      const m = (svc.model ?? "").toLowerCase();
      if (m.includes("qwen") || m.includes("chat") || m.includes("instruct")) {
        providerAddress = svc.provider ?? svc.providerAddress ?? "";
        modelName = svc.model ?? modelName;
        verificationType = svc.verifiability ?? verificationType;
        if (providerAddress) break;
      }
    }
    if (!providerAddress && services.length > 0) {
      const first = services[0] as {
        provider?: string;
        providerAddress?: string;
        model?: string;
        verifiability?: string;
      };
      providerAddress = first.provider ?? first.providerAddress ?? "";
      modelName = first.model ?? modelName;
      verificationType = first.verifiability ?? verificationType;
    }
  }
  if (!providerAddress) {
    throw new Error(
      "[demo-compute] No 0G Compute providers found. Pin one via COMPUTE_PROVIDER_ADDRESS env.",
    );
  }
  console.log(`[demo-compute]   provider: ${providerAddress}`);
  console.log(`[demo-compute]   model:    ${modelName}`);
  console.log(`[demo-compute]   verify:   ${verificationType}`);

  // Step 3 — acknowledge provider (idempotent). The SDK throws on
  // "already acknowledged" — swallow it.
  try {
    console.log("[demo-compute]   acknowledgeProviderSigner…");
    await broker.inference.acknowledgeProviderSigner(providerAddress);
    console.log("[demo-compute]   acknowledged OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already/i.test(msg) || /acknowledged/i.test(msg)) {
      console.log("[demo-compute]   already acknowledged — skipping");
    } else {
      console.log(`[demo-compute]   acknowledge failed (continuing): ${msg.slice(0, 200)}`);
    }
  }

  // Step 4 — service metadata + headers, then OpenAI-compatible call.
  const meta = await broker.inference.getServiceMetadata(providerAddress);
  const endpoint = (meta as { endpoint?: string }).endpoint ?? "";
  const apiModel = (meta as { model?: string }).model ?? modelName;
  if (!endpoint) {
    throw new Error("[demo-compute] getServiceMetadata returned no endpoint");
  }
  console.log(`[demo-compute]   endpoint: ${endpoint}`);

  const headers = (await broker.inference.getRequestHeaders(providerAddress)) as Record<
    string,
    string
  >;

  const requestBody = {
    model: apiModel,
    messages: [{ role: "user", content: opts.prompt }],
    max_tokens: 256,
    temperature: 0.2,
  };

  console.log("[demo-compute] === Inference call ===");
  const httpRes = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(requestBody),
  });

  if (!httpRes.ok) {
    const errBody = await httpRes.text().catch(() => "(no body)");
    throw new Error(
      `[demo-compute] inference HTTP ${httpRes.status}: ${errBody.slice(0, 400)}`,
    );
  }
  const json = (await httpRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const responseText = json.choices?.[0]?.message?.content ?? "";
  console.log(`[demo-compute]   response (${responseText.length} chars):`);
  console.log(`[demo-compute]   ${responseText.slice(0, 200).replace(/\n/g, " ")}…`);

  return {
    providerAddress,
    endpoint,
    modelName: apiModel,
    verificationType,
    prompt: opts.prompt,
    responseText,
    usage: {
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
    },
    rawResponse: json,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const provider = new JsonRpcProvider(RPC);
  const signer = new Wallet(PRIVATE_KEY!, provider);
  console.log(`[demo-compute] Signer (TEE oracle): ${signer.address}`);

  const network = await provider.getNetwork();
  const chainIdNum = Number(network.chainId);
  if (chainIdNum !== 16602 && chainIdNum !== 16661) {
    throw new Error(
      `Expected Galileo (16602) or Aristotle (16661); got ${network.chainId}`,
    );
  }
  const networkLabel = chainIdNum === 16661 ? "Aristotle (mainnet)" : "Galileo (testnet)";
  console.log(`[demo-compute] ${networkLabel} chainId confirmed: ${chainIdNum}`);
  console.log(`[demo-compute] AgenticID: ${AGENTICID_ADDRESS}`);

  const sessionId = `ses_defi_compute_${Date.now()}`;
  const containerHash = `0x${"d".repeat(64)}`;
  const agentId = signer.address;

  // ─── 0G Compute call (seq 0) ────────────────────────────────────────
  const computePrompt =
    "You are a DeFi trading agent. Given USDC=$1.00 and ETH=$2380.42, " +
    "with a 1000 USDC swap to ETH at 50bps max slippage, the simulated " +
    "swap returned 0.4198 ETH (5bps actual slippage). Should we proceed? " +
    "Answer in ONE short paragraph with a clear yes/no recommendation.";

  let inferenceResult: ComputeInferenceResult;
  try {
    inferenceResult = await callComputeProvider({ signer, prompt: computePrompt });
  } catch (err) {
    console.error("[demo-compute] FATAL: 0G Compute inference failed:");
    console.error(err);
    console.error("");
    console.error("Hint: ensure the wallet is funded on Galileo testnet AND has");
    console.error("acknowledged at least one 0G Compute provider via");
    console.error("`0g-compute-cli inference acknowledge-provider --provider <ADDR>`.");
    process.exit(1);
  }

  // Build storage + agenticID clients
  // Mainnet + slow-testnet protection: SessionLogger's BDD upload bound
  // (30s) sometimes rejects too aggressively for live demo mints.  Allow
  // STORAGE_UPLOAD_TIMEOUT_MS env override (default 120s for demo
  // scripts vs the 30s ceiling for production code paths).
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
  const logger = new SessionLogger(sessionId, storageClient);

  let baseTs = Date.now();

  // ─── Inference entry (seq 0) ────────────────────────────────────────
  {
    const inferenceParams = {
      model: inferenceResult.modelName,
      provider: inferenceResult.providerAddress,
      endpoint: inferenceResult.endpoint,
      verificationType: inferenceResult.verificationType,
      prompt: inferenceResult.prompt,
    };
    const inferenceLogResult = {
      // Field names match the Epic-7 BDD acceptance criteria (story
      // story-epic-07-mainnet-deploy.md Scenario 3): {model, provider,
      // endpoint, verificationType, usage}. Renamed from providerAddress
      // / modelName per Codex pre-push review.
      model: inferenceResult.modelName,
      provider: inferenceResult.providerAddress,
      endpoint: inferenceResult.endpoint,
      verificationType: inferenceResult.verificationType,
      usage: inferenceResult.usage,
      response: inferenceResult.responseText,
      // Note: the raw provider response is NOT included — it can contain
      // duplicates of the response text and bloat the log. The hash anchors
      // integrity; the structured fields above are what the dashboard renders.
    };
    const inputHash = sha256HexNoPrefix(inferenceParams);
    const outputHash = sha256HexNoPrefix(inferenceLogResult);
    const sealId = `0x${"0".repeat(63)}1`; // 0x000…001 — first seal
    const signedAt = Math.floor(baseTs / 1000);
    const teeSignature = signEntry({
      signer,
      agentId,
      sealId,
      signedAt,
      outputHash,
    });

    const entry: ExecutionLogEntry = {
      seq: 0,
      ts: baseTs,
      type: "inference",
      modelId: MODEL_ID_LOG,
      inputHash,
      outputHash,
      teeSignature,
      teeSigningAddress: signer.address,
      agentId,
      sealId,
      signedAt,
      params: inferenceParams,
      result: inferenceLogResult,
    };
    logger.appendEntry(entry);
    console.log(`[demo-compute] seq #0 inference appended (0G Compute, signed)`);
  }

  // ─── Tool entries (seq 1-4) ─────────────────────────────────────────
  for (let i = 0; i < SWAP_STEPS.length; i++) {
    const step = SWAP_STEPS[i];
    baseTs += step.delayMs;
    const inputHash = sha256HexNoPrefix(step.params);
    const outputHash = sha256HexNoPrefix(step.result);
    const sealId = `0x${(i + 2).toString().padStart(64, "0")}`;
    const signedAt = Math.floor(baseTs / 1000);

    const teeSignature = signEntry({
      signer,
      agentId,
      sealId,
      signedAt,
      outputHash,
    });

    const entry: ExecutionLogEntry = {
      seq: i + 1, // shifted by +1 because inference is seq 0
      ts: baseTs,
      type: "tool_call",
      tool: step.tool,
      inputHash,
      outputHash,
      teeSignature,
      teeSigningAddress: signer.address,
      agentId,
      sealId,
      signedAt,
      params: step.params,
      result: step.result,
    };
    logger.appendEntry(entry);
    console.log(`[demo-compute] seq #${i + 1} ${step.tool} appended (signed)`);
  }

  // ─── Anchor ─────────────────────────────────────────────────────────
  const agenticIdClient = new AgenticIDClient(AGENTICID_ADDRESS, provider, signer);
  const anchor = new SessionAnchor(logger, agenticIdClient, agentId, MODEL_ID_LOG, {
    chainId: chainIdNum,
  });

  console.log(`[demo-compute] Anchoring session…`);
  const start = Date.now();
  const result = await anchor.anchor({ sessionId, containerHash });
  const elapsed = Date.now() - start;

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("✅ DEFI SWAP + 0G COMPUTE DEMO ANCHORED");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`  AgenticID:   ${AGENTICID_ADDRESS}`);
  console.log(`  tokenId:     ${result.tokenId.toString()}`);
  console.log(`  txHash:      ${result.txHash}`);
  console.log(`  rootHash:    ${result.rootHash}`);
  console.log(`  entryCount:  ${result.entryCount}`);
  console.log(`  verifyUrl:   ${result.verifyUrl}`);
  console.log(`  elapsed:     ${elapsed}ms`);
  console.log("");
  console.log("  Entries (seq → type/tool):");
  console.log(`    0 → inference (0G Compute / ${inferenceResult.modelName})`);
  for (let i = 0; i < SWAP_STEPS.length; i++) {
    console.log(`    ${i + 1} → tool_call (${SWAP_STEPS[i].tool})`);
  }
  console.log("");
  console.log("  Dashboard (local dev):");
  console.log(`    http://localhost:3000/verify/${result.tokenId.toString()}`);
  console.log("");
  const explorerHost =
    chainIdNum === 16661 ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai";
  console.log(`  ${networkLabel} explorer:`);
  console.log(
    `    ${explorerHost}/token/${AGENTICID_ADDRESS}?a=${result.tokenId.toString()}`,
  );
  console.log("════════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("[demo-compute] FAILED:", err);
  process.exit(1);
});
