/**
 * GET /api/verify/[tokenId]/blob — encrypted envelope passthrough.
 *
 * v0.3.0 SECURITY: this route exists so the client can decrypt
 * receipts **without ever exposing the reveal key to the server**.
 * The route is intentionally key-blind:
 *
 *   1. Server resolves tokenId → AgenticID → 0G Storage rootHash
 *   2. Downloads the encrypted envelope from the storage indexer
 *   3. Returns the raw envelope JSON to the client
 *
 * The client (EncryptedReveal) then reads `window.location.hash`,
 * extracts `#k=<base64url>`, and decrypts in the browser. The
 * reveal key never touches:
 *   - the URL query string (no `?k=` parsing here),
 *   - the request body,
 *   - any server log / reverse proxy log / APM trace.
 *
 * For legacy plaintext receipts (token 0 + pre-v0.3.0 mints), this
 * route returns 422 BLOB_NOT_ENCRYPTED — the client should fall back
 * to `/api/verify/<tokenId>` which renders the SessionView directly.
 */

import { NextResponse } from "next/server";

import { ProofResolutionError, fetchEncryptedEnvelope } from "@/lib/verify-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
): Promise<NextResponse> {
  const { tokenId } = await context.params;
  try {
    const envelope = await fetchEncryptedEnvelope(tokenId);
    return NextResponse.json(envelope, { status: 200 });
  } catch (cause) {
    if (cause instanceof ProofResolutionError) {
      return NextResponse.json(
        { error: { code: cause.code, message: cause.message } },
        { status: cause.status },
      );
    }
    console.error("[/api/verify/.../blob] unexpected error:", cause);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected failure fetching envelope. Check server logs.",
        },
      },
      { status: 500 },
    );
  }
}
