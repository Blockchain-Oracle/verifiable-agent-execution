/**
 * client-verify.ts — browser-side per-entry verification.
 *
 * For v0.3.0 encrypted receipts the server is key-blind, so the
 * dashboard's "Verify on chain" badge cascade can't call
 * /api/verify/<id>/entry/<seq> (the server can't decrypt the entry).
 * Instead, EncryptedReveal hands SessionView this `verifyEntryClient`
 * function and SessionView calls it per-entry.
 *
 * Verification path mirrors `verifyOneEntry` in `verify-proof.ts`:
 *
 *   1. Reconstruct the agent-wrapper signing digest:
 *        keccak256(toUtf8Bytes(`${agentId}|${sealId}|${signedAt}|${outputHash}`))
 *   2. Try local ECDSA recover with `recoverAddress(digest, sig)`.
 *      If recovered === entry.agentId → verified (agent-wrapper signed).
 *   3. Fall back to on-chain MockTEEVerifier.verifyTEESignature for
 *      legacy entries signed by a global oracle (token 0 demo). Uses
 *      a browser-side JsonRpcProvider against the public 0G RPC —
 *      no wallet, no signing, view-only call.
 *
 * Both paths are pure cryptographic checks; no reveal key ever
 * appears in any network request originating from this function.
 */

import { Contract, JsonRpcProvider, keccak256, recoverAddress, toUtf8Bytes } from "ethers";

const VERIFIER_ABI = [
  "function verifyTEESignature(bytes32 hash, bytes calldata signature) external view returns (bool)",
] as const;

export type ClientEntryStatus = "verified" | "unverified" | "unsigned";

export interface ClientVerifyResult {
  seq: number;
  verified: ClientEntryStatus;
  reason?: string;
  durationMs: number;
}

export interface ClientVerifyDeps {
  rpcUrl: string;
  verifierAddress: string;
}

export interface ClientVerifyEntry {
  seq: number;
  outputHash: string;
  teeSignature?: string;
  agentId?: string;
  sealId?: string;
  signedAt?: number;
}

let cachedVerifier: { url: string; addr: string; contract: Contract } | null = null;

function getVerifier(rpcUrl: string, verifierAddress: string): Contract {
  if (
    cachedVerifier !== null &&
    cachedVerifier.url === rpcUrl &&
    cachedVerifier.addr === verifierAddress
  ) {
    return cachedVerifier.contract;
  }
  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(verifierAddress, VERIFIER_ABI, provider);
  cachedVerifier = { url: rpcUrl, addr: verifierAddress, contract };
  return contract;
}

export async function verifyEntryClient(
  entry: ClientVerifyEntry,
  deps: ClientVerifyDeps,
): Promise<ClientVerifyResult> {
  const start = Date.now();
  if (
    entry.teeSignature === undefined ||
    entry.agentId === undefined ||
    entry.sealId === undefined ||
    entry.signedAt === undefined
  ) {
    return { seq: entry.seq, verified: "unsigned", durationMs: Date.now() - start };
  }
  const message = `${entry.agentId}|${entry.sealId}|${entry.signedAt}|${entry.outputHash}`;
  const digest = keccak256(toUtf8Bytes(message));

  // Path A: agent-wrapper convention — ecrecover and compare to agentId.
  //
  // TRUST MODEL (v0.2.0, inherited by v0.3.0, per ADR-10 "TEE-rooted,
  // not trustless"): if `recoverAddress(digest, sig) === entry.agentId`,
  // the dashboard reports "verified" WITHOUT calling the on-chain
  // MockTEEVerifier. This is intentional: the agent's own wallet is
  // the trusted signer for ITS entries — agentId IS the agent
  // identity. The wedge is "the agent wallet binds the content,
  // anchored under tokenId on AgenticID." It is NOT a claim of
  // trustless TEE attestation. Codex round-5 flagged that an attacker
  // can self-declare an agentId, sign with that key, and render
  // green — true, but that's bound to a token THEY minted on
  // AgenticID, which is also their own claim. The chain-of-trust
  // ends at the iNFT owner; making it trustless via a real Phala /
  // 0G TEE oracle is v0.4.0 scope. The pinning test for this design
  // is in apps/dashboard/tests/verifier-route.test.ts.
  try {
    const recovered = recoverAddress(digest, entry.teeSignature);
    if (recovered.toLowerCase() === entry.agentId.toLowerCase()) {
      return { seq: entry.seq, verified: "verified", durationMs: Date.now() - start };
    }
  } catch {
    // Falls through to on-chain verifier.
  }

  // Path B: on-chain MockTEEVerifier (legacy / demo entries signed by
  // global oracle wallet, e.g., token 0). Browser → public 0G RPC →
  // view call. Used when Path A doesn't match — typically signatures
  // by the deployer wallet (synthetic demo) against the deployed
  // verifier's configured teeOracleAddress.
  const verifier = getVerifier(deps.rpcUrl, deps.verifierAddress);
  try {
    const ok = (await verifier.verifyTEESignature(digest, entry.teeSignature)) as boolean;
    return {
      seq: entry.seq,
      verified: ok ? "verified" : "unverified",
      durationMs: Date.now() - start,
    };
  } catch (cause) {
    const reason =
      (cause as { reason?: string } | null)?.reason ??
      (cause instanceof Error ? cause.message : String(cause));
    return {
      seq: entry.seq,
      verified: "unverified",
      reason,
      durationMs: Date.now() - start,
    };
  }
}
