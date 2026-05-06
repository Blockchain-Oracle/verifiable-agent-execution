"use client";

/**
 * EntryCard — one tool call, decoded. Court-exhibit aesthetic:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  #001  quote                                  [BADGE]  │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Input ↓                                               │
 *   │    { from: "USDC", to: "ETH", amount: 1000 }           │
 *   │  Output ↓                                              │
 *   │    { rate: 2380.42, ethOut: 0.42 }                     │
 *   │  inputHash  · 2eb1…f7c1                                │
 *   │  outputHash · 9a44…d201                                │
 *   │  TEE sig    · 0x1c…afef  (signed at 14:32:15)          │
 *   └────────────────────────────────────────────────────────┘
 *
 * The badge has THREE states driven by a per-entry verify call:
 *   - "pending" (initial)  → grey outline, no fill
 *   - "verifying"          → grey outline + pulse
 *   - "verified" / "unverified" / "unsigned" → final color
 *
 * The verifyOnClick prop fires the per-entry verify when called,
 * driving the sequential badge-flip animation that's the PRD's hero
 * moment.
 */

import { useState } from "react";

import { Mono } from "./Mono";

export type EntryStatus =
  | { state: "pending" }
  | { state: "verifying" }
  | { state: "verified" }
  | { state: "unverified"; reason?: string }
  | { state: "unsigned" };

interface EntryProps {
  seq: number;
  ts: number;
  type: string;
  tool?: string;
  inputHash: string;
  outputHash: string;
  hasTeeSignature: boolean;
  params?: unknown;
  result?: unknown;
  status: EntryStatus;
}

export function EntryCard(props: EntryProps) {
  const [paramsOpen, setParamsOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(true);

  return (
    <article className="group rounded-md border border-border bg-surface transition-colors hover:border-border/80">
      <header className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[11px] tabular-nums text-text-secondary">
            #{props.seq.toString().padStart(3, "0")}
          </span>
          <span className="font-sans text-base font-semibold text-text-primary">
            {props.tool ?? props.type}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
            {props.type}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <time
            dateTime={new Date(props.ts).toISOString()}
            className="font-mono text-[11px] tabular-nums text-text-secondary"
          >
            {formatTime(props.ts)}
          </time>
          <EntryBadge status={props.status} />
        </div>
      </header>

      <div className="space-y-4 px-5 py-4">
        <ContentBlock
          label="Input"
          value={props.params}
          fallbackHash={props.inputHash}
          open={paramsOpen}
          onToggle={() => setParamsOpen((v) => !v)}
        />
        <ContentBlock
          label="Output"
          value={props.result}
          fallbackHash={props.outputHash}
          open={resultOpen}
          onToggle={() => setResultOpen((v) => !v)}
        />
      </div>

      <footer className="grid grid-cols-1 gap-y-1 border-t border-border/60 bg-bg/40 px-5 py-3 font-mono text-[11px] text-text-secondary md:grid-cols-2 md:gap-x-8">
        <div className="flex justify-between gap-4">
          <span className="uppercase tracking-wider">inputHash</span>
          <Mono truncate={20} copy>
            {props.inputHash}
          </Mono>
        </div>
        <div className="flex justify-between gap-4">
          <span className="uppercase tracking-wider">outputHash</span>
          <Mono truncate={20} copy>
            {props.outputHash}
          </Mono>
        </div>
        <div className="flex justify-between gap-4 md:col-span-2">
          <span className="uppercase tracking-wider">TEE signature</span>
          <span className="text-text-primary">
            {props.hasTeeSignature ? "present" : "—"}
          </span>
        </div>
      </footer>
    </article>
  );
}

function ContentBlock({
  label,
  value,
  fallbackHash,
  open,
  onToggle,
}: {
  label: string;
  value: unknown;
  fallbackHash: string;
  open: boolean;
  onToggle: () => void;
}) {
  const isPresent = value !== undefined && value !== null;
  const display = isPresent
    ? typeof value === "string"
      ? value
      : safeStringify(value)
    : null;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
      >
        <span className="flex items-center gap-2">
          <Caret open={open} />
          {label}
          {!isPresent && (
            <span className="font-sans text-[10px] normal-case tracking-normal text-text-secondary">
              (redacted — sha256 only)
            </span>
          )}
        </span>
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded border border-border/40 bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-text-primary">
          {display ?? `sha256: ${fallbackHash}`}
        </pre>
      )}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function EntryBadge({ status }: { status: EntryStatus }) {
  switch (status.state) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
          <span className="h-1 w-1 rounded-full bg-text-secondary/60" />
          Awaiting verify
        </span>
      );
    case "verifying":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-text-secondary/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
          <span className="relative flex h-1 w-1">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-text-secondary opacity-75" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-text-secondary" />
          </span>
          Verifying…
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-verify/40 bg-accent-verify/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-verify drop-shadow-[0_0_4px_rgba(16,185,129,0.4)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="h-2.5 w-2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          TEE Verified
        </span>
      );
    case "unverified":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-unverified/40 bg-accent-unverified/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-unverified"
          title={status.reason}
        >
          ✗ Unverified
        </span>
      );
    case "unsigned":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-mock/40 bg-accent-mock/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-mock">
          Unsigned
        </span>
      );
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
