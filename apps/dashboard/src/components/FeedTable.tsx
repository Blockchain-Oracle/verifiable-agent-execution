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
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <header className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.16em] text-text-primary">
          Latest sessions
        </h2>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-verify opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-verify" />
            </span>
            Live · refresh 15s
          </span>
          <time dateTime={new Date(updatedAt).toISOString()}>
            updated {formatRelativeShort(updatedAt)}
          </time>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg">
            <tr className="text-[10px] uppercase tracking-[0.14em] text-text-secondary">
              <th className="px-5 py-2 font-mono font-normal">Token</th>
              <th className="px-5 py-2 font-mono font-normal">Session</th>
              <th className="px-5 py-2 font-mono font-normal">Agent</th>
              <th className="px-5 py-2 font-mono font-normal">Model</th>
              <th className="px-5 py-2 font-mono font-normal text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tokenId}
                className="border-t border-border/60 transition-colors hover:bg-surface-elev"
              >
                <td className="whitespace-nowrap px-5 py-3 font-mono text-text-primary">
                  <Link
                    href={`/verify/${row.tokenId}`}
                    className="text-link hover:underline"
                  >
                    #{row.tokenId}
                  </Link>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-text-primary">
                  <span title={row.sessionId}>{truncateMiddle(row.sessionId, 14)}</span>
                </td>
                <td className="px-5 py-3 font-mono text-xs">
                  <Link
                    href={`/agent/${row.owner}`}
                    className="text-link hover:underline"
                    title={row.owner}
                  >
                    {truncateAddress(row.owner)}
                  </Link>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-text-secondary">
                  {row.modelId || "—"}
                </td>
                <td className="px-5 py-3 text-right">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-verify/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-verify">
                    <span className="h-1 w-1 rounded-full bg-accent-verify" />
                    Anchored
                  </span>
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
