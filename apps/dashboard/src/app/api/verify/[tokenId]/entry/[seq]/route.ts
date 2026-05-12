/**
 * GET /api/verify/[tokenId]/entry/[seq] — per-entry verify endpoint.
 *
 * Powers the dashboard's badge-flip animation per the PRD reverse
 * demo arc: "click Verify on chain → 4 badges flip from grey to TEE
 * Verified ✓ in sequence". The page renders ALL entries grey on
 * initial load (using the aggregate /api/verify/[tokenId] endpoint
 * for the metadata + entry list), then the client fires N parallel
 * GETs against this endpoint — one per entry seq — and animates the
 * badges as each response lands.
 *
 * Returns:
 *   200 { seq, verified: "verified" | "unverified" | "unsigned",
 *         reason?, durationMs }
 *   400 INVALID_SEQ — seq isn't a non-negative integer
 *   404 TOKEN_NOT_FOUND / ENTRY_NOT_FOUND
 *   422 STORAGE_BLOB_INVALID_*
 *   502 CHAIN_READ_FAILED / STORAGE_DOWNLOAD_FAILED / VERIFIER_CALL_FAILED
 *
 * The "unsigned" status (entry has no teeSignature) is NOT a failure —
 * the badge stays grey, indicating "nothing to verify here." That's
 * a real session state for entries logged outside the TEE container
 * (e.g., a tool call that ran before agent-wrapper attached).
 */

import { NextResponse } from "next/server";

import {
  ProofResolutionError,
  loadSessionLogForToken,
  verifyOneEntry,
} from "@/lib/verify-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string; seq: string }> },
): Promise<NextResponse> {
  const { tokenId, seq } = await context.params;

  if (!/^\d+$/u.test(seq)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SEQ",
          message: `seq must be a non-negative integer; got "${seq}".`,
        },
      },
      { status: 400 },
    );
  }
  const seqNum = Number.parseInt(seq, 10);

  // v0.3.0: forward ?k= for encrypted-receipt support. Without it, an
  // encrypted blob bubbles back as STORAGE_BLOB_ENCRYPTED_NO_KEY (422).
  const url = new URL(request.url);
  const key = url.searchParams.get("k") ?? undefined;

  try {
    const { sessionLog, verifier } = await loadSessionLogForToken(tokenId, key);
    const entry = sessionLog.entries.find((e) => e.seq === seqNum);
    if (entry === undefined) {
      return NextResponse.json(
        {
          error: {
            code: "ENTRY_NOT_FOUND",
            message: `Token ${tokenId} session has ${sessionLog.entries.length.toString()} entries; seq ${seq} not present.`,
          },
        },
        { status: 404 },
      );
    }
    const result = await verifyOneEntry(entry, verifier);
    return NextResponse.json(result, { status: 200 });
  } catch (cause) {
    if (cause instanceof ProofResolutionError) {
      return NextResponse.json(
        {
          error: { code: cause.code, message: cause.message },
        },
        { status: cause.status },
      );
    }
    console.error("[/api/verify/.../entry] unexpected error:", cause);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected failure verifying entry. Check server logs.",
        },
      },
      { status: 500 },
    );
  }
}
