/**
 * scripts/smoke/verify-token.ts
 *
 * Calls the dashboard's resolveProof() against a real tokenId and
 * prints the resolved ProofResponse. Confirms the dashboard's
 * verifier-status logic flips to "verified" for sessions whose
 * entries have signatures recoverable to the deployed verifier's
 * TEE oracle.
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm exec tsx scripts/smoke/verify-token.ts <tokenId>
 *
 * Required env (loaded from .env):
 *   ZG_TESTNET_RPC, ZG_INDEXER_RPC, AGENTICID_ADDRESS, CHAIN_ID
 *   TEE_VERIFIER_ADDRESS  — required to flip badge to "verified"
 */

import { resolveProof } from "../../apps/dashboard/src/lib/verify-proof.js";

const tokenIdRaw = process.argv[2];
if (!tokenIdRaw) {
  console.error("usage: tsx scripts/smoke/verify-token.ts <tokenId>");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[verify-token] Resolving tokenId=${tokenIdRaw}...`);
  const start = Date.now();
  const proof = await resolveProof(tokenIdRaw);
  const elapsed = Date.now() - start;

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("✅ PROOF RESOLVED");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`tokenId:           ${proof.tokenId}`);
  console.log(`sessionId:         ${proof.sessionId}`);
  console.log(`rootHash:          ${proof.rootHash}`);
  console.log(`entryCount:        ${proof.entryCount}`);
  console.log(`verified:          ${proof.verified} ${badgeFor(proof.verified)}`);
  console.log(`meta.chainId:      ${proof.meta.chainId}`);
  console.log(`meta.dataDescription: ${proof.meta.dataDescription}`);
  console.log(`elapsed:           ${elapsed}ms`);
  console.log("");
  console.log("Entries:");
  for (const e of proof.entries ?? []) {
    console.log(
      `  #${e.seq.toString().padStart(3, "0")} ${e.type} ${e.tool ?? ""} hasTeeSig=${e.hasTeeSignature}`,
    );
  }
  console.log("════════════════════════════════════════════════════════════════");
}

function badgeFor(status: string): string {
  switch (status) {
    case "verified":
      return "🟢 (TEE Verified — green badge)";
    case "preview":
      return "🟡 (Mock — amber badge)";
    case "unverified":
      return "🔴 (Unverified — red badge)";
    default:
      return "";
  }
}

main().catch((err) => {
  console.error("[verify-token] FAILED:", err);
  process.exit(1);
});
