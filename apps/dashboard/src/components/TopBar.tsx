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
  // LIVE pulsing dot + network label (Etherscan-style live indicator).
  // The dot color signals network: mainnet uses accent-verify (#10B981);
  // testnet uses muted (text-secondary). The pulse animation comes from
  // Tailwind's built-in `animate-ping` overlaid on a solid core dot so
  // the indicator is legible on the dark surface.
  //
  // Cross-link (right half) jumps to the sibling deployment when a URL
  // is configured. On localhost the default URLs aren't reachable —
  // render the chip without the link so we don't paint a 404.
  const dotCore = isMainnet ? "bg-accent-verify" : "bg-text-secondary";
  const dotPing = isMainnet
    ? "bg-accent-verify/60"
    : "bg-text-secondary/60";
  const chipClasses = isMainnet
    ? "border-accent-verify/40 bg-accent-verify/10 text-accent-verify"
    : "border-border bg-surface text-text-secondary";

  const showCrossLink =
    typeof badge.oppositeUrl === "string" && badge.oppositeUrl.length > 0;

  // The chip itself renders on EVERY viewport (mobile users need the
  // active-network signal too). The "view <other> ↗" cross-link is
  // hidden below `md` to keep the mobile TopBar from wrapping — the
  // chip alone carries the LIVE indicator + network label per Codex
  // round-7 frontend finding. (Prior version was `hidden md:flex` on
  // the entire container, which hid the chip on mobile entirely.)
  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]"
      aria-label={`Live on ${badge.label}`}
    >
      <span
        className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 ${chipClasses}`}
      >
        <span className="relative inline-flex h-1.5 w-1.5">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${dotPing}`}
            aria-hidden="true"
          />
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotCore}`}
            aria-hidden="true"
          />
        </span>
        <span>Live · {badge.label}</span>
      </span>
      {showCrossLink ? (
        <a
          href={badge.oppositeUrl}
          target="_blank"
          rel="noreferrer"
          className="hidden text-text-secondary transition-colors hover:text-text-primary md:inline"
        >
          view {badge.oppositeLabel.toLowerCase()} ↗
        </a>
      ) : null}
    </div>
  );
}
