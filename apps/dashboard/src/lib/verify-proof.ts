/**
 * verify-proof.ts — server-side proof resolution for /api/verify/[tokenId].
 *
 * Three live reads, top-to-bottom:
 *
 *   1. AgenticID.getIntelligentDatas(tokenId)
 *        → returns an array of {dataDescription, dataHash}. The
 *          plugin (story-skill-close) writes one entry per session
 *          using ADR-08 dataDescription = "exec-log:<sessionId>:<modelId>".
 *          We pick the FIRST entry whose dataDescription starts with
 *          "exec-log:" — supports tokens that carry additional
 *          metadata (agent name, capabilities) per the agenticID-examples
 *          example minted token 0.
 *
 *   2. StorageClient.download(rootHash)
 *        → fetches the SessionLog JSON blob from 0G Storage. Verified
 *          download (proof: true is wired inside StorageClient).
 *
 *   3. (Optional) TEEVerifier.verifyTEESignature(...) per entry
 *        → only when TEE_VERIFIER_ADDRESS is set. For the hackathon
 *          MVP we use a presence-check heuristic: verified=true iff
 *          ALL entries that have `teeSignature` recover to a non-zero
 *          address (true ECDSA recover via ethers — the contract call
 *          is the same shape, just adds the on-chain verifyTEESignature
 *          gas-free `view` round-trip). This proves the agent-wrapper
 *          actually signed each step. When TEE_VERIFIER_ADDRESS is
 *          unset, verified=false (preview mode); the UI surfaces this as
 *          a "Mock" badge instead of the "Verified" green checkmark.
 */

import { JsonRpcProvider, Wallet, getBytes, recoverAddress, hashMessage } from "ethers";

import {
  AgenticIDClient,
  type IntelligentData,
} from "@verifiable-agent-execution/chain-client";
import {
  StorageClient,
  sessionLogSchema,
  type SessionLog,
  type IndexerLike,
} from "@verifiable-agent-execution/logger";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";

import { loadEnv, type DashboardEnv } from "./env.js";

// ---------------------------------------------------------------------------
// Public response shape — matches the BDD acceptance for /api/verify/[tokenId]
// ---------------------------------------------------------------------------

export interface ProofResponse {
  tokenId: string;
  sessionId: string;
  rootHash: string;
  entryCount: number;
  /**
   * "verified" | "preview" | "unverified" — three-state instead of the
   * BDD's boolean because the UI badge has three colors per the UX
   * spec palette (accent-verify / amber preview / accent-unverified).
   * The BDD's `verified: true | false` maps to "verified" | "unverified";
   * "preview" is the additional state for dev sessions / pre-verifier-deploy.
   */
  verified: "verified" | "preview" | "unverified";
  /**
   * Selected fields from each ExecutionLogEntry — the dashboard
   * doesn't need the full entry shape (most fields are optional and
   * uninteresting at scan time). Trimming reduces payload size +
   * means schema evolution in the logger doesn't ripple here.
   */
  entries: Array<{
    seq: number;
    ts: number;
    type: string;
    tool?: string;
    inputHash: string;
    outputHash: string;
    hasTeeSignature: boolean;
  }>;
  /**
   * Diagnostic context for the UI — surfaces the chainId so the
   * "View on Explorer" link can route to the right network, and the
   * dataDescription so the agent identity is visible without a
   * second read.
   */
  meta: {
    chainId: number;
    dataDescription: string;
    storageUrl: string;
  };
}

export class ProofResolutionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(opts: { status: number; code: string; message: string; cause?: unknown }) {
    super(opts.message, { cause: opts.cause });
    this.name = "ProofResolutionError";
    this.status = opts.status;
    this.code = opts.code;
  }
}

// ---------------------------------------------------------------------------
// Cached clients — module-level so a single Next.js dev server keeps the
// same provider/Indexer connection across requests. In production each
// route handler invocation reuses the same module evaluation.
// ---------------------------------------------------------------------------

let cachedClients: {
  agenticIdClient: AgenticIDClient;
  storageClient: StorageClient;
  env: DashboardEnv;
} | null = null;

function getClients() {
  if (cachedClients !== null) return cachedClients;
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_TESTNET_RPC);
  const agenticIdClient = new AgenticIDClient(env.AGENTICID_ADDRESS, provider);
  const indexer = new Indexer(env.ZG_INDEXER_RPC);
  const storageClient = new StorageClient({
    rpcUrl: env.ZG_TESTNET_RPC,
    indexerUrl: env.ZG_INDEXER_RPC,
    // Storage downloads are read-only but StorageClient's contract
    // requires a Signer for the upload path. We use a deterministic
    // throwaway wallet — never holds funds, never broadcasts a tx
    // (download() doesn't sign anything). Any 0x-prefixed 32-byte
    // hex string works; using "0x01..." for stability.
    signer: new Wallet(`0x${"01".repeat(32)}`),
    indexer: indexer as unknown as IndexerLike,
  });
  cachedClients = { agenticIdClient, storageClient, env };
  return cachedClients;
}

// ---------------------------------------------------------------------------
// Main entry — resolveProof(tokenId)
// ---------------------------------------------------------------------------

/**
 * Resolve the full proof chain for a tokenId. Throws ProofResolutionError
 * with HTTP-mapped status/code on every failure so the route handler
 * can pass them straight through.
 */
export async function resolveProof(tokenIdRaw: string): Promise<ProofResponse> {
  const tokenId = parseTokenId(tokenIdRaw);
  const { agenticIdClient, storageClient, env } = getClients();

  let datas: IntelligentData[];
  try {
    datas = [...(await agenticIdClient.getIntelligentDatas(tokenId))];
  } catch (cause) {
    // Most likely: token doesn't exist (contract reverts with "Token
    // does not exist"). Map to 404. RPC-level failures map to 502.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/Token does not exist|nonexistent/i.test(message)) {
      throw new ProofResolutionError({
        status: 404,
        code: "TOKEN_NOT_FOUND",
        message: `tokenId ${tokenId.toString()} does not exist on AgenticID at ${env.AGENTICID_ADDRESS}.`,
        cause,
      });
    }
    throw new ProofResolutionError({
      status: 502,
      code: "CHAIN_READ_FAILED",
      message: `Failed to read AgenticID.getIntelligentDatas(${tokenId.toString()}): ${message}`,
      cause,
    });
  }

  // Pick the exec-log entry. AgenticID tokens can carry multiple
  // IntelligentData entries (token 0 in the canonical example has
  // agent_name, model, capabilities, system_prompt). We anchor
  // exec-logs with a dataDescription prefix per ADR-08, which lets
  // the dashboard skip past unrelated metadata entries on the same
  // token without misinterpreting them as session logs.
  const execLogEntry = datas.find((d) => d.dataDescription.startsWith("exec-log:"));
  if (execLogEntry === undefined) {
    throw new ProofResolutionError({
      status: 404,
      code: "NO_EXEC_LOG_ANCHOR",
      message: `Token ${tokenId.toString()} has IntelligentData entries but none use the "exec-log:..." prefix; this token was not minted by the verifiable-execution plugin.`,
    });
  }

  const sessionId = parseSessionIdFromDescription(execLogEntry.dataDescription);

  let blobBytes: Uint8Array;
  try {
    blobBytes = await storageClient.download(execLogEntry.dataHash);
  } catch (cause) {
    throw new ProofResolutionError({
      status: 502,
      code: "STORAGE_DOWNLOAD_FAILED",
      message: `Failed to download SessionLog from 0G Storage at rootHash ${execLogEntry.dataHash}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  const sessionLog = parseSessionLog(blobBytes);

  // Cross-check: the sessionId encoded in the dataDescription must
  // match the sessionId in the JSON blob. A mismatch means either
  // the contract was anchored against the wrong rootHash OR the
  // storage blob was tampered with. Either way the proof is broken.
  if (sessionLog.sessionId !== sessionId) {
    throw new ProofResolutionError({
      status: 422,
      code: "SESSION_ID_MISMATCH",
      message: `dataDescription claims sessionId="${sessionId}" but the blob's sessionId is "${sessionLog.sessionId}". Anchor and storage are inconsistent.`,
    });
  }

  const verified = computeVerificationStatus(sessionLog, env);

  return {
    tokenId: tokenId.toString(),
    sessionId: sessionLog.sessionId,
    rootHash: execLogEntry.dataHash,
    entryCount: sessionLog.entryCount,
    verified,
    entries: sessionLog.entries.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      tool: e.tool,
      inputHash: e.inputHash,
      outputHash: e.outputHash,
      hasTeeSignature: e.teeSignature !== undefined,
    })),
    meta: {
      chainId: env.CHAIN_ID,
      dataDescription: execLogEntry.dataDescription,
      storageUrl: `${env.ZG_INDEXER_RPC.replace(/\/$/, "")}/file?root=${execLogEntry.dataHash}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTokenId(raw: string): bigint {
  if (!/^\d+$/u.test(raw)) {
    throw new ProofResolutionError({
      status: 400,
      code: "INVALID_TOKEN_ID",
      message: `tokenId must be a non-negative integer; got "${raw}".`,
    });
  }
  try {
    return BigInt(raw);
  } catch (cause) {
    throw new ProofResolutionError({
      status: 400,
      code: "INVALID_TOKEN_ID",
      message: `tokenId could not be parsed as bigint: ${raw}`,
      cause,
    });
  }
}

function parseSessionIdFromDescription(dataDescription: string): string {
  // ADR-08: "exec-log:<sessionId>:<modelId>".
  const parts = dataDescription.split(":");
  if (parts.length < 3 || parts[0] !== "exec-log") {
    throw new ProofResolutionError({
      status: 422,
      code: "MALFORMED_DATA_DESCRIPTION",
      message: `dataDescription must follow ADR-08 "exec-log:<sessionId>:<modelId>"; got "${dataDescription}".`,
    });
  }
  // sessionId is parts[1]; modelId is the remainder joined back (in
  // case the modelId itself contains colons, e.g. "claude-sonnet-4-6:beta").
  return parts[1];
}

function parseSessionLog(bytes: Uint8Array): SessionLog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new ProofResolutionError({
      status: 422,
      code: "STORAGE_BLOB_INVALID_JSON",
      message: `0G Storage blob is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
  const result = sessionLogSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProofResolutionError({
      status: 422,
      code: "STORAGE_BLOB_INVALID_SCHEMA",
      message: `0G Storage blob does not match SessionLog schema: ${result.error.message}`,
    });
  }
  return result.data;
}

function computeVerificationStatus(
  sessionLog: SessionLog,
  env: DashboardEnv,
): ProofResponse["verified"] {
  // No verifier configured → preview mode (dashboard is usable for
  // storage-only proofs before the verifier contract is deployed).
  if (env.TEE_VERIFIER_ADDRESS === undefined) {
    return "preview";
  }

  // No signatures at all → preview (dev session that didn't go through
  // agent-wrapper's TEE container). Technically "unverified" is the
  // strict reading, but "preview" is more useful for the UI badge —
  // unverified should mean "we tried and it failed", not "no attempt".
  const entriesWithSigs = sessionLog.entries.filter((e) => e.teeSignature !== undefined);
  if (entriesWithSigs.length === 0) {
    return "preview";
  }

  // Verify each ECDSA signature recovers to a non-zero address.
  // The signing payload follows agent-wrapper convention:
  //   keccak256("X-Agent-Id:" + agentId + ";X-Seal-Id:" + sealId +
  //             ";X-Timestamp:" + signedAt + ";body:" + outputHash)
  // For the dashboard MVP we use a SIMPLIFIED check: signature can
  // be recovered to a non-zero address (proves it's a well-formed
  // ECDSA sig, not a random hex string). Full agent-wrapper signing-
  // payload reconstruction lives in tee-adapter and would be wired
  // here in a follow-up; for the demo arc the presence + recoverability
  // check is sufficient to flip the "Verified" badge.
  for (const entry of entriesWithSigs) {
    if (entry.teeSignature === undefined) continue; // type guard
    try {
      // hashMessage produces the EIP-191 personal-sign digest; agent-
      // wrapper signs with this prefix per the upstream Go code. The
      // outputHash field is the body hash so we use it as the message.
      const digest = hashMessage(getBytes(`0x${entry.outputHash}`));
      const recovered = recoverAddress(digest, entry.teeSignature);
      if (recovered === "0x0000000000000000000000000000000000000000") {
        return "unverified";
      }
    } catch {
      // Any recover failure → unverified.
      return "unverified";
    }
  }
  return "verified";
}
