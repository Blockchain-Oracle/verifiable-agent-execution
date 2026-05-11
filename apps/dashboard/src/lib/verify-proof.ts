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
 *          hot-path no-pinned-key rule (Codex web R1 P2 on
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
import {
  agenticIdContractUrl,
  agenticIdTokenUrl,
  faucetUrl,
  storageBlobUrl,
  teeVerifierContractUrl,
} from "./explorer.js";

// ---------------------------------------------------------------------------
// TEE verifier ABI — minimal subset of the deployed verifier contract
// (full source lives in the contracts/ workspace package). The
// dashboard only needs the read function; deploy-time helpers and
// the constructor are out of scope here.
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
    /**
     * Decoded tool input — present when the plugin captured
     * unredacted serializable params. Hash field above (`inputHash`)
     * is always present; this is additive content for the dashboard
     * to render the actual story (Stage 3, 2026-05-06).
     */
    params?: unknown;
    /**
     * Decoded tool output. Same semantics as `params`.
     */
    result?: unknown;
    /**
     * True when the operator chose to redact this entry's content.
     * The hashes still anchor integrity; params/result are absent
     * by design.
     */
    redacted?: boolean;
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
    /**
     * Pre-computed explorer URLs — server-side resolves these so the
     * client never needs to know about chain switches. When self-hosting
     * on mainnet (CHAIN_ID=16661), these auto-route to chainscan.0g.ai.
     */
    explorer: {
      token: string;       // AgenticID iNFT page filtered to this tokenId
      contract: string;    // AgenticID contract page (no filter)
      verifierContract: string; // MockTEEVerifier contract page
    };
    /** Pre-computed faucet URL (testnet only). */
    faucetUrl: string;
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
// previously constructed a Wallet from a baked-in private key.)
// ---------------------------------------------------------------------------

interface CachedClients {
  provider: Provider;
  agenticIdClient: AgenticIDClient;
  indexer: Indexer;
  /**
   * Always present now — TEE_VERIFIER_ADDRESS is a compiled-in
   * constant (env.ts), no longer a user-supplied env var. The
   * `null` branch in computeVerificationStatus that used to mean
   * "no verifier configured → preview" is gone; "preview" only
   * fires when a session has zero teeSignature entries.
   */
  verifier: Contract;
  env: DashboardEnv;
}

let cachedClients: CachedClients | null = null;

function getClients(): CachedClients {
  if (cachedClients !== null) return cachedClients;
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_RPC);
  const agenticIdClient = new AgenticIDClient(env.AGENTICID_ADDRESS, provider);
  const indexer = new Indexer(env.ZG_INDEXER_RPC);
  const verifier = new Contract(
    env.TEE_VERIFIER_ADDRESS,
    TEE_VERIFIER_ABI,
    provider,
  );
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

/**
 * Load + parse the SessionLog for a tokenId. Used by the per-entry
 * verify route (Stage 5 — badge-flip animation) so the route can
 * grab one entry by seq without reconstructing the whole proof.
 *
 * Throws ProofResolutionError on the same paths as resolveProof
 * (404 token-not-found, 422 schema mismatch, 502 chain/storage
 * transport failure).
 */
export async function loadSessionLogForToken(
  tokenIdRaw: string,
): Promise<{ sessionLog: SessionLog; verifier: Contract }> {
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
      message: `Token ${tokenId.toString()} has no exec-log anchor.`,
    });
  }

  const blobBytes = await downloadStorageBlob(indexer, execLogEntry.dataHash);
  const sessionLog = parseSessionLog(blobBytes);
  return { sessionLog, verifier };
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
      // Decoded content — additive, only present on entries the plugin
      // captured AFTER the Stage 3 schema upgrade (2026-05-06). Old
      // SessionLog blobs without these fields render as hash-only,
      // which is the correct degraded behavior.
      ...(e.params !== undefined ? { params: e.params } : {}),
      ...(e.result !== undefined ? { result: e.result } : {}),
      ...(e.redacted === true ? { redacted: true } : {}),
    })),
    meta: {
      chainId: env.CHAIN_ID,
      dataDescription: execLogEntry.dataDescription,
      storageUrl: storageBlobUrl(execLogEntry.dataHash),
      explorer: {
        token: agenticIdTokenUrl(tokenId),
        contract: agenticIdContractUrl(),
        verifierContract: teeVerifierContractUrl(),
      },
      faucetUrl: faucetUrl(),
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
/**
 * Verify ONE entry against the verifier contract. Returns a per-entry
 * status that the dashboard can use to drive the badge-flip animation
 * (PRD reverse-demo arc: "click Verify on chain → 4 badges flip from
 * grey to TEE Verified ✓ in sequence").
 *
 * Three outcomes:
 *   - "unsigned": entry has no teeSignature OR is missing the
 *     attestation fields (agentId/sealId/signedAt). Badge stays grey;
 *     not a failure, just nothing to verify.
 *   - "verified": signature recovered to the trusted oracle on-chain.
 *     Badge flips green.
 *   - "unverified": verifier said no. Badge flips red.
 *
 * Throws ProofResolutionError on infrastructure failure (RPC down,
 * wrong contract address, etc.) so the route can surface 502 rather
 * than misreport an outage as a verification failure.
 */
export type EntryVerificationStatus = "verified" | "unverified" | "unsigned";

export interface EntryVerificationResult {
  seq: number;
  verified: EntryVerificationStatus;
  /** Revert reason from the contract (when verified === "unverified"). */
  reason?: string;
  /** Wall-clock ms to perform the verifyTEESignature call. */
  durationMs: number;
}

export async function verifyOneEntry(
  entry: SessionLog["entries"][number],
  verifier: Contract,
): Promise<EntryVerificationResult> {
  const start = Date.now();
  if (entry.teeSignature === undefined || !hasAttestationFields(entry)) {
    return { seq: entry.seq, verified: "unsigned", durationMs: Date.now() - start };
  }
  const message = `${entry.agentId}|${entry.sealId}|${entry.signedAt}|${entry.outputHash}`;
  const digest = signingMessageDigestFromString(message);
  let ok: boolean;
  try {
    ok = (await verifier.verifyTEESignature(digest, entry.teeSignature)) as boolean;
  } catch (cause) {
    const code = (cause as { code?: string } | null)?.code;
    const reason = (cause as { reason?: string | null } | null)?.reason;
    if (code === "CALL_EXCEPTION" && typeof reason === "string" && reason.length > 0) {
      console.error(
        "[verify-proof] verifier reverted on entry %d: %s",
        entry.seq,
        reason,
      );
      return {
        seq: entry.seq,
        verified: "unverified",
        reason,
        durationMs: Date.now() - start,
      };
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ProofResolutionError({
      status: 502,
      code: "VERIFIER_CALL_FAILED",
      message: `Verifier RPC call failed for entry ${entry.seq} (${code ?? "unknown code"}): ${message}`,
      cause,
    });
  }
  return {
    seq: entry.seq,
    verified: ok ? "verified" : "unverified",
    durationMs: Date.now() - start,
  };
}

async function computeVerificationStatus(
  sessionLog: SessionLog,
  verifier: Contract,
): Promise<ProofResponse["verified"]> {
  // Verifier is always present now (compiled-in default in env.ts).
  // The "no verifier configured" branch from the previous version is
  // gone — "preview" only fires for sessions with zero signed entries
  // (dev sessions that didn't go through agent-wrapper's TEE container).
  //
  // This is the AGGREGATE status used by the initial /api/verify/[tokenId]
  // response. The badge-flip animation uses verifyOneEntry() per entry
  // (Stage 5, 2026-05-06) so the UI can drive sequential reveal.

  const entriesWithSigs = sessionLog.entries.filter(
    (e) => e.teeSignature !== undefined,
  );
  if (entriesWithSigs.length === 0) {
    // Session has no signed entries — dev session that didn't go
    // through agent-wrapper's TEE container. "preview" not
    // "unverified" so the badge tells the user "this is real but
    // not attested" rather than "this failed verification".
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
    } catch (cause) {
      // Discriminate verifier-said-no from infrastructure-failure.
      //
      // ethers v6 throws CALL_EXCEPTION for BOTH:
      //   (a) the verifier contract reverted with a require() — e.g.
      //       MockTEEVerifier.sol's `require(signature.length == 65,
      //       "Invalid signature length")`. This IS the verifier
      //       saying "no" and maps to verified="unverified".
      //   (b) wrong contract address (calling a non-contract or a
      //       contract without our ABI shape), wrong network, ABI
      //       decoding failure, etc. These are MISCONFIG / infra and
      //       must surface as 502, not silently masquerade as
      //       failed-verification.
      //
      // Discriminator: `error.reason` is set IFF the contract actually
      // executed and called revert() with a string. ethers populates
      // it from the decoded revert data. Wrong-address calls, no-bytecode
      // calls, and gas/network failures all leave `reason` null/undefined.
      // (Codex web R3 P1 on PR #21.)
      const code = (cause as { code?: string } | null)?.code;
      const reason = (cause as { reason?: string | null } | null)?.reason;
      const message = cause instanceof Error ? cause.message : String(cause);
      const isContractRevertWithReason =
        code === "CALL_EXCEPTION" && typeof reason === "string" && reason.length > 0;
      if (isContractRevertWithReason) {
        // Verifier ran + returned revert with a reason — legitimate
        // "no" answer. Log the reason so operators can correlate
        // dashboards-saying-unverified with the underlying contract
        // revert string.
        console.error(
          "[verify-proof] verifier reverted on entry %d: %s",
          entry.seq,
          reason,
        );
        return "unverified";
      }
      // Anything else (CALL_EXCEPTION without reason, NETWORK_ERROR,
      // TIMEOUT, INVALID_ARGUMENT, etc.) — re-throw as a 502 so the
      // route handler surfaces the infrastructure failure. The
      // verifier is `view`-only so true RPC failures are rare; when
      // they happen it means the dashboard env is misconfigured
      // (wrong rpcUrl, wrong verifier address pointing at a non-
      // contract, RPC outage). Judges seeing 502 know "we couldn't
      // verify" instead of being misled into "this proof failed."
      throw new ProofResolutionError({
        status: 502,
        code: "VERIFIER_CALL_FAILED",
        message: `Verifier RPC call failed for entry ${entry.seq} (${code ?? "unknown code"}): ${message}`,
        cause,
      });
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
