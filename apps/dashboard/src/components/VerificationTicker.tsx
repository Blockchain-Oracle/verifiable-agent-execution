"use client";

/**
 * VerificationTicker — the Bloomberg-style scrolling ticker that
 * narrates the verify cascade as it happens.
 *
 * Shows: "VERIFYING #001 quote → ✓ verified · #002 liquidity → ✓ verified · ..."
 *
 * Driven by the same `statuses` state that powers the per-entry
 * badges. Renders below the TopBar, above the hero. As statuses flip
 * from pending → verifying → verified, the ticker text rebuilds and
 * scrolls in.
 *
 * Pattern adapted from 21st.dev's Marquee component (linear infinite
 * loop with whitespace-nowrap), tightened for our broadsheet aesthetic
 * (mono uppercase, single-color, no gradient fades).
 */

import type { EntryStatus } from "./EntryCard";

export interface TickerEntry {
  seq: number;
  tool?: string;
  status: EntryStatus;
}

export function VerificationTicker({ entries }: { entries: TickerEntry[] }) {
  const allDone = entries.every(
    (e) =>
      e.status.state === "verified" ||
      e.status.state === "unverified" ||
      e.status.state === "error" ||
      e.status.state === "unsigned",
  );
  const anyVerifying = entries.some((e) => e.status.state === "verifying");
  const allVerified = entries.every((e) => e.status.state === "verified");

  const segments = entries.map((e) => {
    const tool = (e.tool ?? "step").toUpperCase();
    const seq = `#${e.seq.toString().padStart(3, "0")}`;
    switch (e.status.state) {
      case "pending":
        return { text: `${seq} ${tool} — PENDING`, tone: "muted" as const };
      case "verifying":
        return { text: `${seq} ${tool} — VERIFYING…`, tone: "active" as const };
      case "verified":
        return { text: `${seq} ${tool} → ✓ VERIFIED`, tone: "verified" as const };
      case "unverified":
        return { text: `${seq} ${tool} → ✗ UNVERIFIED`, tone: "unverified" as const };
      case "error":
        return { text: `${seq} ${tool} ⚠ RPC ERROR`, tone: "unverified" as const };
      case "unsigned":
        return { text: `${seq} ${tool} — UNSIGNED`, tone: "muted" as const };
    }
  });

  // Build one repeat-set; the marquee track renders it twice for the
  // seamless infinite loop.
  const repeatSet = (
    <div className="flex shrink-0 items-center gap-12 px-12">
      {segments.map((s, i) => (
        <span
          key={i}
          className={
            "font-mono text-[11px] uppercase tracking-[0.16em] " +
            (s.tone === "verified"
              ? "text-accent-verify"
              : s.tone === "unverified"
                ? "text-accent-unverified"
                : s.tone === "active"
                  ? "text-text-primary"
                  : "text-text-secondary")
          }
        >
          {s.text}
        </span>
      ))}
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">
        ·
      </span>
    </div>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative isolate flex w-full items-center overflow-hidden border-y border-border bg-bg/95"
      style={{ height: 36 }}
    >
      {/* Status pill at the left — sticky relative to the ticker, not
          the marquee. */}
      <div className="absolute left-0 top-0 z-10 flex h-full items-center gap-2 border-r border-border bg-surface px-4">
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (allDone
              ? allVerified
                ? "bg-accent-verify"
                : "bg-accent-unverified"
              : anyVerifying
                ? "animate-pulse bg-accent-verify"
                : "bg-text-secondary/60")
          }
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-primary">
          {allDone
            ? allVerified
              ? "All verified"
              : "Verification complete"
            : anyVerifying
              ? "Verifying…"
              : "Awaiting verify"}
        </span>
      </div>

      {/* Marquee track — translateX from 0 to -50% in linear loop;
          duplicated content guarantees no visible seam. */}
      <div className="ml-[200px] flex w-full overflow-hidden">
        <div
          className="flex animate-[ticker_24s_linear_infinite] items-center"
          style={{ minWidth: "200%" }}
        >
          {repeatSet}
          {repeatSet}
        </div>
      </div>
    </div>
  );
}
