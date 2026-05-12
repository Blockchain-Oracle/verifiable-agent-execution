/**
 * GET /api/verify/[tokenId] — proof-chain resolver.
 *
 * Server-only. Reads from chain + storage on every request (no
 * caching layer wired yet — Epic 6 polish would add Vercel Runtime
 * Cache with tag-based invalidation here, see vercel:runtime-cache
 * skill). For the demo arc the request count is low enough that
 * uncached reads are fine.
 *
 * Returns the BDD-required JSON shape {tokenId, sessionId, rootHash,
 * entryCount, verified, entries}. The ProofResolutionError thrown by
 * `resolveProof` carries the right HTTP status; we pass it through
 * unmodified so 404 / 422 / 502 surface cleanly to the UI.
 */

import { NextResponse } from "next/server";

import { ProofResolutionError, resolveProof } from "@/lib/verify-proof";

// Force the route to run on the Node runtime (not Edge). The 0G
// Storage SDK uses node:crypto + node-net which aren't available
// on Edge. Same constraint as ethers.JsonRpcProvider.
export const runtime = "nodejs";

// Don't pre-render at build time — every request needs fresh chain
// + storage reads.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
): Promise<NextResponse> {
  const { tokenId } = await context.params;
  // v0.3.0: optional `?k=<base64url-key>` query forwards the share-link
  // fragment that the page-level client component reads from
  // window.location.hash. The fragment NEVER leaves the browser
  // server-side automatically — we forward it explicitly via this query
  // param after the client decodes the hash. Without `?k=` an
  // encrypted token returns `verified: "encrypted"` + empty entries.
  const url = new URL(request.url);
  const key = url.searchParams.get("k") ?? undefined;
  try {
    const proof = await resolveProof(tokenId, key);
    return NextResponse.json(proof, { status: 200 });
  } catch (cause) {
    if (cause instanceof ProofResolutionError) {
      return NextResponse.json(
        {
          error: {
            code: cause.code,
            message: cause.message,
          },
        },
        { status: cause.status },
      );
    }
    // Unexpected — log + 500 with a generic body. Don't leak the
    // raw error message because it might contain RPC URLs / etc.
    console.error("[/api/verify] unexpected error:", cause);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Unexpected failure resolving proof. Check server logs.",
        },
      },
      { status: 500 },
    );
  }
}
