/**
 * Mono — primitive for ALL identifiers, hashes, addresses, sessionIds.
 *
 * Geist Mono. Tabular nums for hash readability. Optional truncation
 * (with a tooltip showing the full value), optional copy button.
 *
 * Use everywhere there's hex / numeric data — keeps the broadsheet
 * tone consistent and prevents prose font from creeping into data.
 */

"use client";

import { useState } from "react";

interface MonoProps {
  children: string;
  /** If set, truncate to this many chars + show full on hover. */
  truncate?: number;
  /** Show a copy-to-clipboard button on hover. */
  copy?: boolean;
  className?: string;
}

export function Mono({ children, truncate, copy = false, className = "" }: MonoProps) {
  const [copied, setCopied] = useState(false);
  const display =
    truncate !== undefined && children.length > truncate + 3
      ? `${children.slice(0, Math.ceil(truncate / 2))}…${children.slice(-Math.floor(truncate / 2))}`
      : children;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard API unavailable; fail silently
    }
  }

  return (
    <span
      title={children}
      className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${className}`}
    >
      <span>{display}</span>
      {copy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy to clipboard"
          className="text-text-secondary opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
        >
          {copied ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-3 w-3 text-accent-verify"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
              />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}
