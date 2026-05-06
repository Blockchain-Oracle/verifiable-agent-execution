/**
 * TopBar — sticky header on every page. Logo-left, search-center.
 *
 * Aesthetic: editorial cryptographic broadsheet.
 *   - Wordmark in Geist Sans 700 with extra letter-spacing
 *   - Sub-label "Etherscan for AI agents · Galileo testnet · 0G"
 *     in Geist Mono uppercase to set the forensic tone
 *   - Search bar centered with a thin border, mono input
 *   - Sharp 1px divider beneath
 */

import Link from "next/link";

import { SearchBar } from "./SearchBar";

export function TopBar() {
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
            Etherscan for AI agents · Galileo
          </span>
        </Link>
        <div className="flex-1">
          <SearchBar />
        </div>
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
