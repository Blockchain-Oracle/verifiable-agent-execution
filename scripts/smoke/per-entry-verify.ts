/**
 * scripts/smoke/per-entry-verify.ts
 *
 * Hits the per-entry verify path (Stage 5) against a real tokenId,
 * one entry at a time, to confirm the dashboard's badge-flip
 * animation has real material to drive.
 *
 * Run:
 *   set -a && source .env && set +a
 *   pnpm exec tsx scripts/smoke/per-entry-verify.ts <tokenId>
 */

import { loadSessionLogForToken, verifyOneEntry } from "../../apps/dashboard/src/lib/verify-proof.js";

const tokenIdRaw = process.argv[2];
if (!tokenIdRaw) {
  console.error("usage: tsx scripts/smoke/per-entry-verify.ts <tokenId>");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[per-entry-verify] tokenId=${tokenIdRaw}`);
  const { sessionLog, verifier } = await loadSessionLogForToken(tokenIdRaw);
  console.log(
    `[per-entry-verify] Loaded ${sessionLog.entries.length.toString()} entries from session ${sessionLog.sessionId}`,
  );
  console.log("");
  console.log("Per-entry verification (one verifyTEESignature call each):");
  console.log("──────────────────────────────────────────────────────────");
  for (const entry of sessionLog.entries) {
    const result = await verifyOneEntry(entry, verifier);
    const badge =
      result.verified === "verified"
        ? "🟢 verified"
        : result.verified === "unsigned"
          ? "⚪ unsigned"
          : "🔴 unverified";
    const tool = entry.tool ?? entry.type;
    console.log(
      `  #${entry.seq.toString().padStart(3, "0")} ${tool.padEnd(20, " ")} ${badge.padEnd(15, " ")} (${result.durationMs}ms)${result.reason ? `  reason: ${result.reason}` : ""}`,
    );
  }
  console.log("──────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("[per-entry-verify] FAILED:", err);
  process.exit(1);
});
