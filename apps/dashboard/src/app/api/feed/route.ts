/**
 * /api/feed — recent exec-log tokens. Powers the landing page's
 * live feed table (auto-refreshed client-side every ~15s).
 *
 * Cached for 10s server-side via Next's `revalidate` so a viral
 * link doesn't hammer the RPC. The page itself does client-side
 * polling on top, accepting the 10s staleness.
 *
 * NOTE on `dynamic`: we INTENTIONALLY do NOT set `dynamic =
 * "force-dynamic"` here because that disables route caching entirely
 * and silently nullifies `revalidate`. Earlier versions had both,
 * which let every request through to the chain even though the
 * docstring promised a 10s cache. (Codex bot round-12 P2 on PR #23.)
 */

import { NextResponse } from "next/server";

import { fetchRecentFeed } from "@/lib/feed";

export const runtime = "nodejs";
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await fetchRecentFeed();
    return NextResponse.json({ rows, fetchedAt: Date.now() });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: { code: "FEED_FETCH_FAILED", message } },
      { status: 502 },
    );
  }
}
