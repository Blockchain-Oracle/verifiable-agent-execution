/**
 * TopBar — sticky header on every page. Logo-left, search-center,
 * network-chip-right.
 *
 * Aesthetic: editorial cryptographic broadsheet.
 *   - Wordmark in Geist Sans 700 with extra letter-spacing
 *   - Sub-label "Etherscan for AI agents · <network>" in Geist Mono
 *     uppercase to set the forensic tone
 *   - Search bar centered with a thin border, mono input
 *   - Network chip on the right shows the active chain (TESTNET /
 *     MAINNET) with a cross-link to the sibling deployment so judges
 *     can switch with one click. Coloring matches the UX-spec palette:
 *     mainnet uses accent-verify (#10B981); testnet stays muted.
 *   - Sharp 1px divider beneath
 */

import Link from "next/link";

import { loadEnv, networkBadge } from "@/lib/env";

import { SearchBar } from "./SearchBar";

export function TopBar() {
  const env = loadEnv();
  const badge = networkBadge(env);
  const isMainnet = badge.label === "MAINNET";
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:gap-8 sm:px-6 sm:py-4">
        <Link
          href="/"
          className="group flex flex-col leading-none transition-opacity hover:opacity-80"
        >
          <span className="font-sans text-lg font-bold tracking-tight text-text-primary">
            VERIFIABLE EXECUTION
          </span>
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
            Etherscan for AI agents · {badge.network}
          </span>
        </Link>
        <div className="flex-1">
          <SearchBar />
        </div>
        <NetworkChip badge={badge} isMainnet={isMainnet} />
        <a
          href="https://github.com/Blockchain-Oracle/verifiable-agent-execution"
          target="_blank"
          rel="noreferrer"
          className="hidden font-mono text-xs uppercase tracking-[0.12em] text-text-secondary transition-colors hover:text-text-primary md:block"
        >
          GitHub →
        </a>
      </div>
    </header>
  );
}

function NetworkChip({
  badge,
  isMainnet,
}: {
  badge: ReturnType<typeof networkBadge>;
  isMainnet: boolean;
}) {
  // Static label (left half) styled per network; cross-link (right half)
  // links to the sibling deployment when a URL is configured. On
  // localhost the default URLs aren't reachable — render the chip without
  // the link so we don't paint a 404.
  const labelClasses = isMainnet
    ? "border-accent-verify/40 bg-accent-verify/10 text-accent-verify"
    : "border-border bg-surface text-text-secondary";

  const showCrossLink =
    typeof badge.oppositeUrl === "string" && badge.oppositeUrl.length > 0;

  return (
    <div
      className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] md:flex"
      aria-label={`Active network: ${badge.label}`}
    >
      <span
        className={`rounded-sm border px-2 py-1 ${labelClasses}`}
      >
        {badge.label}
      </span>
      {showCrossLink ? (
        <a
          href={badge.oppositeUrl}
          target="_blank"
          rel="noreferrer"
          className="text-text-secondary transition-colors hover:text-text-primary"
        >
          view {badge.oppositeLabel.toLowerCase()} ↗
        </a>
      ) : null}
    </div>
  );
}
