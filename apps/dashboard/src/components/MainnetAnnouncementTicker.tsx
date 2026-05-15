"use client";

/**
 * MainnetAnnouncementTicker — full-width "🟢 LIVE ON MAINNET" strip
 * above the existing TopBar. Tier 1.6 from Abu's 2026-05-15 plan.
 *
 * Behavior:
 *   - ONLY renders on the testnet site (the mainnet site already IS
 *     mainnet; showing the strip there would be silly).
 *   - Scrolling marquee using the existing `ticker 24s linear
 *     infinite` keyframe (defined in globals.css, originally for
 *     VerificationTicker). No new CSS.
 *   - Dismissible: clicking the × persists a flag in localStorage so
 *     judges returning to the dashboard within a session don't see
 *     the strip again. Reappears when the flag expires or the user
 *     clears storage.
 *   - Pure prefers-reduced-motion respect: the keyframe already
 *     no-ops under `prefers-reduced-motion: reduce` per globals.css
 *     line 58-67. The text remains visible (just static).
 *
 * Content choice (per the brand voice — sparse, broadsheet, no
 * marketing-speak):
 *   🟢 LIVE ON MAINNET · Anchor + verify on 0G Aristotle
 *   · mainnet.agentscan.online · open →
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "agentscan:mainnet-banner-dismissed";

interface MainnetAnnouncementTickerProps {
  /**
   * True when the current deploy is mainnet. We refuse to render
   * the "live on mainnet" strip on the mainnet site itself; on the
   * testnet site (`isMainnet === false`) the strip serves as a
   * cross-link to the mainnet subdomain.
   */
  isMainnet: boolean;
  /**
   * Cross-link destination — `https://mainnet.agentscan.online`
   * (or whatever `lib/env.ts`'s networkBadge returns as
   * `oppositeUrl`). Passed in so the component stays env-agnostic.
   */
  mainnetHref: string;
}

export function MainnetAnnouncementTicker({
  isMainnet,
  mainnetHref,
}: MainnetAnnouncementTickerProps) {
  // SSR-safe: render the strip server-side then let useEffect drop
  // it if the visitor already dismissed it. Without this gate, the
  // server would render it on every page and the dismiss action
  // would flash-of-content. localStorage isn't available server-side.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") {
        setDismissed(true);
      }
    } catch {
      // localStorage can throw in private-browsing / cookie-blocked
      // mode — fail open (show the strip).
    }
  }, []);

  // Don't render on mainnet or when dismissed.
  if (isMainnet) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best-effort persistence — if it fails, the strip will
      // reappear on the next page load, which is fine.
    }
  };

  // One repeat-block of content; the marquee track duplicates it for
  // a seamless wraparound. The keyframe translates 0 → -50% so the
  // duplicate covers the gap.
  const repeatBlock = (
    <div className="flex shrink-0 items-center gap-8 px-8">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
        <span className="text-accent-verify">●</span>{" "}
        <span className="text-text-primary">LIVE ON MAINNET</span>
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
        Anchor &amp; verify on 0G Aristotle
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
        mainnet.agentscan.online
      </span>
      <a
        href={mainnetHref}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-verify underline decoration-accent-verify/40 underline-offset-2 transition-colors hover:decoration-accent-verify"
      >
        Open →
      </a>
      <span
        aria-hidden="true"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary"
      >
        ·
      </span>
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Mainnet announcement"
      className="relative isolate flex w-full items-center overflow-hidden border-b border-accent-verify/30 bg-accent-verify/[0.04]"
      style={{ height: 32 }}
    >
      {/* The marquee track — 200% min-width so two copies of
          repeatBlock occupy 100% each; the keyframe translates
          -50% which is exactly one block's width. */}
      <div className="flex w-full overflow-hidden">
        <div
          className="flex animate-[ticker_24s_linear_infinite] items-center"
          style={{ minWidth: "200%" }}
        >
          {repeatBlock}
          {repeatBlock}
        </div>
      </div>
      {/* Dismiss × pinned to the right. `bg-bg` keeps it readable
          against the moving marquee underneath. */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss mainnet announcement"
        className="absolute right-0 top-0 z-10 flex h-full items-center border-l border-accent-verify/30 bg-bg/80 px-3 font-mono text-[11px] text-text-secondary transition-colors hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
