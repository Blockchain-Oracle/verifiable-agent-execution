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
 *   2. Indexer.downloadToBlob(rootHash, { proof: true })
 *        → fetches the SessionLog JSON blob from 0G Storage. Verified
 *          download (proof: true). We use the Indexer SDK directly
 *          rather than packages/logger StorageClient because the
 *          dashboard only does READ access — StorageClient's
 *          constructor requires a Signer for the upload path, and
 *          constructing a placeholder Wallet violates the §14
 *          hot-path no-hardcoded-secrets rule (Codex web R1 P2 on
 *          PR #20). Direct Indexer access has no signer surface.
 *
 *   3. TEEVerifier.verifyTEESignature(digest, signature) per entry
 *        → instantiates the deployed verifier contract via ethers
 *          and calls the on-chain `view` function. The digest is
 *          reconstructed with `tee-adapter/signing-message` per the
 *          agent-wrapper convention:
 *             keccak256(toUtf8Bytes(`${agentId}|${sealId}|${timestamp}|${bodyHashHex}`))
 *          where bodyHashHex IS the entry's outputHash (already
 *          sha256-hex-no-0x of the body — that's what agent-wrapper
 *          sticks into the signing message). Aggregates per-entry
 *          results into a single ProofResponse.verified status.
 *
 *          When TEE_VERIFIER_ADDRESS is unset, verified="preview"
 *          (dashboard usable for storage-only proofs before the
 *          verifier is deployed). When verifier is set but no entries
 *          carry a teeSignature, verified="preview" too (dev session
 *          that didn't go through agent-wrapper). Only when the
 *          verifier IS configured AND all signed entries verify
 *          on-chain do we return "verified".
 */

import {
  Contract,
  JsonRpcProvider,
  type Provider,
} from "ethers";

import {
  AgenticIDClient,
  type IntelligentData,
} from "@verifiable-agent-execution/chain-client";
import {
  sessionLogSchema,
  type SessionLog,
} from "@verifiable-agent-execution/logger";
import { signingMessageDigestFromString } from "@verifiable-agent-execution/tee-adapter";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";

import { loadEnv, type DashboardEnv } from "./env.js";

// ---------------------------------------------------------------------------
// TEE verifier ABI — exact match for the deployed MockTEEVerifier.sol
// (see contracts/contracts/MockTEEVerifier.sol). The dashboard only needs
// the read function; deploy-time helpers and the constructor are out of
// scope here.
// ---------------------------------------------------------------------------

const TEE_VERIFIER_ABI = [
  "function verifyTEESignature(bytes32 hash, bytes calldata signature) external view returns (bool)",
] as const;

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
   * The BDD's `verified: true | false` maps to "verified" |
   * "unverified"; "preview" is the additional state for dev sessions
   * (no signatures present) and pre-verifier-deploy environments
   * (TEE_VERIFIER_ADDRESS unset).
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
//
// No Signer/Wallet construction here: the dashboard is read-only, and
// all three clients (AgenticIDClient, Indexer, verifier Contract) take
// only a Provider. (Closes Codex web R1 P2 on PR #20: hot-path source
// previously constructed a Wallet from a hardcoded private key.)
// ---------------------------------------------------------------------------

interface CachedClients {
  provider: Provider;
  agenticIdClient: AgenticIDClient;
  indexer: Indexer;
  verifier: Contract | null;
  env: DashboardEnv;
}

let cachedClients: CachedClients | null = null;

function getClients(): CachedClients {
  if (cachedClients !== null) return cachedClients;
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_TESTNET_RPC);
  const agenticIdClient = new AgenticIDClient(env.AGENTICID_ADDRESS, provider);
  const indexer = new Indexer(env.ZG_INDEXER_RPC);
  const verifier =
    env.TEE_VERIFIER_ADDRESS !== undefined
      ? new Contract(env.TEE_VERIFIER_ADDRESS, TEE_VERIFIER_ABI, provider)
      : null;
  cachedClients = { provider, agenticIdClient, indexer, verifier, env };
  return cachedClients;
}

/**
 * Test-only seam: lets the verifier-route + verify-proof tests inject
 * stubbed clients without going through env validation or instantiating
 * real ethers / Indexer objects. Production code never calls this.
 */
export function __setCachedClientsForTests(clients: CachedClients | null): void {
  cachedClients = clients;
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
  const { agenticIdClient, indexer, verifier, env } = getClients();

  let datas: IntelligentData[];
  try {
    datas = [...(await agenticIdClient.getIntelligentDatas(tokenId))];
  } catch (cause) {
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

  const execLogEntry = datas.find((d) => d.dataDescription.startsWith("exec-log:"));
  if (execLogEntry === undefined) {
    throw new ProofResolutionError({
      status: 404,
      code: "NO_EXEC_LOG_ANCHOR",
      message: `Token ${tokenId.toString()} has IntelligentData entries but none use the "exec-log:..." prefix; this token was not minted by the verifiable-execution plugin.`,
    });
  }

  const sessionId = parseSessionIdFromDescription(execLogEntry.dataDescription);

  const blobBytes = await downloadStorageBlob(indexer, execLogEntry.dataHash);
  const sessionLog = parseSessionLog(blobBytes);

  if (sessionLog.sessionId !== sessionId) {
    throw new ProofResolutionError({
      status: 422,
      code: "SESSION_ID_MISMATCH",
      message: `dataDescription claims sessionId="${sessionId}" but the blob's sessionId is "${sessionLog.sessionId}". Anchor and storage are inconsistent.`,
    });
  }

  const verified = await computeVerificationStatus(sessionLog, verifier);

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
  return parts[1];
}

async function downloadStorageBlob(
  indexer: Indexer,
  rootHash: string,
): Promise<Uint8Array> {
  // 0G Storage SDK uses `[result, err]` Go-style tuples — destructure
  // both, throw on err per logger/StorageClient convention. proof:true
  // ensures the blob is verified against the Merkle proof on download.
  let tuple: Awaited<ReturnType<Indexer["downloadToBlob"]>>;
  try {
    tuple = await indexer.downloadToBlob(rootHash, { proof: true });
  } catch (cause) {
    throw new ProofResolutionError({
      status: 502,
      code: "STORAGE_DOWNLOAD_FAILED",
      message: `0G Storage downloadToBlob threw for rootHash=${rootHash}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
  const [blob, err] = tuple;
  if (err !== null) {
    throw new ProofResolutionError({
      status: 502,
      code: "STORAGE_DOWNLOAD_FAILED",
      message: `0G Storage download failed for rootHash=${rootHash}: ${err.message}`,
    });
  }
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch (cause) {
    throw new ProofResolutionError({
      status: 502,
      code: "STORAGE_DOWNLOAD_FAILED",
      message: `Failed to read storage blob for rootHash=${rootHash}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
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

/**
 * Compute the verification status for a session log via on-chain
 * verifyTEESignature calls. The verifier contract is the source of
 * truth — we don't ECDSA-recover client-side and trust the result;
 * the contract holds the trusted-signer address constant and does
 * the recover + compare for us. (Closes Codex web R1 P1 + Logic
 * fail on PR #20: "verified" was previously set whenever ANY
 * signature recovered to a non-zero address, which an attacker can
 * trivially produce.)
 */
async function computeVerificationStatus(
  sessionLog: SessionLog,
  verifier: Contract | null,
): Promise<ProofResponse["verified"]> {
  if (verifier === null) {
    // No verifier configured → preview mode (dashboard usable for
    // storage-only proofs before the verifier contract is deployed
    // to mainnet).
    return "preview";
  }

  const entriesWithSigs = sessionLog.entries.filter(
    (e) => e.teeSignature !== undefined,
  );
  if (entriesWithSigs.length === 0) {
    // Verifier configured but the session has no signed entries —
    // dev session that didn't go through agent-wrapper's TEE
    // container. Preview, not unverified, so the badge tells the
    // user "this is real but not attested" rather than "this failed
    // verification".
    return "preview";
  }

  for (const entry of entriesWithSigs) {
    if (!hasAttestationFields(entry)) {
      // Has signature but missing the agentId / sealId / signedAt
      // fields needed to reconstruct the signing digest. Cannot
      // verify → unverified (something is malformed about how the
      // entry was logged).
      return "unverified";
    }
    // Reconstruct the agent-wrapper signing message digest. The
    // bodyHashHex piece IS the entry's outputHash (sha256 of the
    // response body, lowercase hex no 0x prefix — that's what
    // agent-wrapper writes into the signing message per the upstream
    // Go convention; see tee-adapter/signing-message.ts).
    const message = `${entry.agentId}|${entry.sealId}|${entry.signedAt}|${entry.outputHash}`;
    const digest = signingMessageDigestFromString(message);
    let ok: boolean;
    try {
      ok = (await verifier.verifyTEESignature(digest, entry.teeSignature)) as boolean;
    } catch {
      // Contract revert (wrong sig length, bad signature shape, etc.)
      // → unverified. The verifier is `view` so transport issues
      // here would be unusual and would also indicate a misconfig.
      return "unverified";
    }
    if (!ok) {
      return "unverified";
    }
  }

  // All signed entries passed on-chain verification.
  return "verified";
}

function hasAttestationFields(entry: {
  agentId?: string;
  sealId?: string;
  signedAt?: number;
}): entry is { agentId: string; sealId: string; signedAt: number } {
  return (
    typeof entry.agentId === "string" &&
    typeof entry.sealId === "string" &&
    typeof entry.signedAt === "number"
  );
}
