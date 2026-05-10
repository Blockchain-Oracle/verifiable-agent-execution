"use client";

/**
 * SearchBar — intelligent router. Paste anything, jump there:
 *   - Numeric (e.g. "0")      → /verify/0
 *   - 0x-prefixed 20-byte hex → /agent/0x...
 *   - 0x-prefixed 32-byte hex → /verify-by-hash/0x... (TODO; for now,
 *     unknown — surface a lightweight error toast)
 *   - Anything else           → no-op + visual error tick
 *
 * Same UX as Etherscan's top-bar paste-anything-and-jump.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;
const TOKEN_ID_RE = /^\d+$/u;

export function SearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (TOKEN_ID_RE.test(v)) {
      setError(null);
      router.push(`/verify/${v}`);
      return;
    }
    if (ADDRESS_RE.test(v)) {
      setError(null);
      router.push(`/agent/${v}`);
      return;
    }
    setError("Paste a tokenId (e.g. 98) or an agent address (0x...)");
  }

  return (
    <form onSubmit={submit} className="relative w-full">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 transition-colors focus-within:border-text-secondary">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-4 w-4 text-text-secondary"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error !== null) setError(null);
          }}
          placeholder="Search by tokenId (0) or agent address (0x...)"
          className="w-full bg-transparent font-mono text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
          aria-label="Search by tokenId or agent address"
        />
        <kbd className="hidden font-mono text-[10px] uppercase tracking-wider text-text-secondary md:inline-block">
          Enter
        </kbd>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="absolute left-0 top-full mt-1.5 font-mono text-[11px] text-accent-unverified"
        >
          {error}
        </p>
      )}
    </form>
  );
}
