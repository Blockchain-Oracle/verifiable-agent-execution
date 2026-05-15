"use client";

/**
 * MainnetAnnouncementTicker — static "🟢 LIVE ON MAINNET" strip
 * above the existing TopBar.
 *
 * History:
 *   - Tier 1.6 (2026-05-15): originally implemented as a scrolling
 *     marquee using the `ticker 24s linear infinite` keyframe.
 *   - 2026-05-15 (later same day): Abu's critique — "why did you do
 *     it as a life [scrolling] ticker? It should be in one place,
 *     not posting one place; this is only news." The scrolling-news
 *     vibe felt cheap. Rewrote as a static centered strip — same
 *     content, same dismiss behavior, no animation.
 *
 * Behavior:
 *   - ONLY renders on the testnet site (the mainnet site already IS
 *     mainnet; showing the strip there would be silly).
 *   - Dismissible: clicking the × persists a flag in localStorage so
 *     judges returning to the dashboard within a session don't see
 *     the strip again. Reappears when the flag expires or the user
 *     clears storage.
 *   - SSR-safe: server renders unconditionally; useEffect reads
 *     localStorage on mount and hides if previously dismissed.
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

  if (isMainnet) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best-effort persistence — fine if it fails.
    }
  };

  return (
    <div
      role="region"
      aria-label="Mainnet announcement"
      className="relative flex w-full items-center justify-center border-b border-accent-verify/30 bg-accent-verify/[0.04] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span className="flex items-center gap-1.5">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-verify/60"
              aria-hidden="true"
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-verify"
              aria-hidden="true"
            />
          </span>
          <span className="text-text-primary">LIVE ON MAINNET</span>
        </span>
        <span aria-hidden="true" className="text-text-secondary">
          ·
        </span>
        <span className="text-text-secondary">Anchor &amp; verify on 0G Aristotle</span>
        <span aria-hidden="true" className="text-text-secondary">
          ·
        </span>
        <a
          href={mainnetHref}
          target="_blank"
          rel="noreferrer"
          className="text-accent-verify underline decoration-accent-verify/40 underline-offset-2 transition-colors hover:decoration-accent-verify"
        >
          mainnet.agentscan.online &rarr;
        </a>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss mainnet announcement"
        className="absolute right-0 top-0 flex h-full items-center px-3 text-text-secondary transition-colors hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
