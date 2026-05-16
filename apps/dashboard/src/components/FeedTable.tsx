"use client";

/**
 * FeedTable — landing page's live feed of recent agent sessions.
 *
 * Auto-polls /api/feed every 15s (matches the server cache TTL) so
 * new mints appear without a refresh. Each row is dense Etherscan-
 * style: tokenId · agent (truncated) · session id (truncated) · model
 * · "TEE Verified" badge.
 *
 * Renders client-side with an initial server payload (passed as
 * prop) so the first paint is real data — no skeleton flash on the
 * critical above-the-fold area.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { FeedRow } from "@/lib/feed";

import { Mono } from "./Mono";

const POLL_INTERVAL_MS = 15_000;

export function FeedTable({ initialRows }: { initialRows: FeedRow[] }) {
  const [rows, setRows] = useState(initialRows);
  // updatedAt = 0 on the server render so SSR and the first client render
  // agree. The post-mount effect fills it in. Without this, calling
  // Date.now() during render produced a hydration mismatch (the server
  // and client clocks differ by hundreds of ms over the wire). The
  // <time> element below conditionally renders only when the value is
  // populated.
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUpdatedAt(Date.now());
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/feed", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { rows: FeedRow[]; fetchedAt: number };
        if (!cancelled) {
          setRows(body.rows);
          setUpdatedAt(body.fetchedAt);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="overflow-hidden rounded-md border border-border/80 bg-surface/90 shadow-[0_20px_70px_rgba(0,0,0,0.24)]">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/80 px-4 py-4 sm:px-5">
        <div>
          <h2 className="font-sans text-base font-semibold text-text-primary">
            Latest receipts
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            OpenClaw sessions anchored on 0G
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          <span className="flex items-center gap-1.5 rounded-full border border-accent-verify/25 bg-accent-verify/10 px-2.5 py-1 text-accent-verify">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-verify opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-verify" />
            </span>
            Live feed
          </span>
          {updatedAt > 0 && (
            <time dateTime={new Date(updatedAt).toISOString()}>
              updated {formatRelativeShort(updatedAt)}
            </time>
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg/75">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-text-secondary">
              <th className="px-3 py-2 font-mono font-normal sm:px-5">Token</th>
              <th className="px-3 py-2 font-mono font-normal sm:px-5">Session</th>
              <th className="px-3 py-2 font-mono font-normal sm:px-5">Agent</th>
              {/* Model is the least load-bearing column — drop on narrow
                  viewports so Status stays visible without horizontal
                  scroll. */}
              <th className="hidden px-5 py-2 font-mono font-normal md:table-cell">
                Model
              </th>
              <th className="px-3 py-2 text-right font-mono font-normal sm:px-5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tokenId}
                className="border-t border-border/60 transition-colors hover:bg-surface-elev/80"
              >
                <td className="whitespace-nowrap px-3 py-3 font-mono text-text-primary sm:px-5">
                  <Link
                    href={`/verify/${row.tokenId}`}
                    className="rounded-sm text-link transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-link/50"
                  >
                    #{row.tokenId}
                  </Link>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-text-primary sm:px-5">
                  <span title={row.sessionId}>{truncateMiddle(row.sessionId, 14)}</span>
                </td>
                <td className="px-3 py-3 font-mono text-xs sm:px-5">
                  <Link
                    href={`/agent/${row.owner}`}
                    className="rounded-sm text-link transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-link/50"
                    title={row.owner}
                  >
                    {truncateAddress(row.owner)}
                  </Link>
                </td>
                <td className="hidden px-5 py-3 font-mono text-xs text-text-secondary md:table-cell">
                  {row.modelId || "—"}
                </td>
                <td className="px-3 py-3 text-right sm:px-5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-verify/30 bg-accent-verify/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-verify">
                    <span className="h-1 w-1 rounded-full bg-accent-verify" />
                    Anchored
                  </span>
                  {row.recoveryAnchor && (
                    // v0.3.4 — orphan recovery anchor (session_end fired
                    // without a preceding agent_end). The mint is real
                    // and the bytes are durable, but the run terminated
                    // abnormally. Surfacing this in the feed lets
                    // auditors spot the rare case at a glance.
                    <span
                      className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-accent-mock/40 bg-accent-mock/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-mock"
                      title="agent_end never fired; this token was minted by the plugin's session_end recovery branch"
                    >
                      Recovery
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-text-secondary">
                  No sessions found yet. Mint one with{" "}
                  <Mono>pnpm exec tsx scripts/smoke/defi-swap-demo.ts</Mono>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="border-t border-border bg-accent-unverified/5 px-5 py-2 font-mono text-[11px] text-accent-unverified"
        >
          Feed refresh failed: {error} (showing last cached rows)
        </p>
      )}
    </section>
  );
}

function truncateAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function truncateMiddle(s: string, keep: number): string {
  if (s.length <= keep + 3) return s;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatRelativeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}
