/**
 * /api/feed — recent exec-log tokens. Powers the landing page's
 * live feed table (auto-refreshed client-side every ~15s).
 *
 * Cached for 10s server-side via a module-scoped in-memory cache.
 *
 * Why NOT `export const revalidate = 10` on its own:
 *   In Next 14/15 App Router route handlers, `revalidate` alone does
 *   NOT enable caching — the handler still executes on every request
 *   unless we also opt in via `dynamic = "force-static"` (which
 *   forbids dynamic reads) or wrap the work in `unstable_cache`.
 *   A literal in-memory cache here is simplest and most explicit.
 *   (Codex bot round-14 P1 on PR #23: the previous attempt of
 *   `revalidate = 10` with no `force-dynamic` left the route fully
 *   dynamic — every request hit the chain.)
 *
 * Why not `unstable_cache`:
 *   It's unstable and would couple the route handler to the
 *   Next runtime's caching internals. A 10-line module-cache is
 *   self-contained, easy to reason about, and matches the
 *   `cachedCeiling` pattern already in `lib/feed.ts`.
 */

import { NextResponse } from "next/server";

import { fetchRecentFeed, type FeedRow } from "@/lib/feed";

export const runtime = "nodejs";
// Keep the route DYNAMIC at the Next-handler level — we manage caching
// explicitly below so we always know what TTL we're serving and never
// silently hand a stale day-old payload from a build-time prerender.
export const dynamic = "force-dynamic";

interface FeedPayload {
  rows: FeedRow[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 10_000;
let cachedPayload: FeedPayload | null = null;
/** In-flight promise so concurrent requests share one upstream call. */
let inflightFetch: Promise<FeedPayload> | null = null;

async function getCachedFeed(): Promise<FeedPayload> {
  const now = Date.now();
  if (cachedPayload !== null && now - cachedPayload.fetchedAt < CACHE_TTL_MS) {
    return cachedPayload;
  }
  // If a refresh is already in flight, await it instead of starting a
  // second concurrent chain scan (saves RPC on burst traffic).
  if (inflightFetch !== null) {
    return inflightFetch;
  }
  inflightFetch = (async () => {
    try {
      const rows = await fetchRecentFeed();
      const payload: FeedPayload = { rows, fetchedAt: Date.now() };
      cachedPayload = payload;
      return payload;
    } finally {
      inflightFetch = null;
    }
  })();
  return inflightFetch;
}

export async function GET(): Promise<NextResponse> {
  try {
    const payload = await getCachedFeed();
    return NextResponse.json(payload);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: { code: "FEED_FETCH_FAILED", message } },
      { status: 502 },
    );
  }
}
