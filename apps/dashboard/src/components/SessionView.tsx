"use client";

/**
 * SessionView — the four bold moves of the proof-detail page.
 *
 *   1. AUTO-VERIFY ON ARRIVAL: no click required. The verify cascade
 *      fires on mount, badges flip green-by-green as the user reads.
 *      The wow moment lands BEFORE the user does anything.
 *   2. MASSIVE NUMERIC HERO: the tokenId at 96-128px monospace stamp
 *      weight is the visual anchor — Etherscan-for-AI-agents should
 *      make agent identifiers monumental.
 *   3. VERTICAL CONNECTING LINE through the entry list — the chain
 *      reads as a literal chain. Each EntryCard hangs off the
 *      backbone via a small node marker.
 *   4. ROOTHASH WATERMARK in the page background (in the parent
 *      page.tsx) — the proof IS the watermark, like security paper.
 *
 * Plus the live VerificationTicker at the top narrating the cascade.
 *
 * Replay button stays for re-running, but the initial reveal is
 * automatic — the page is a live cryptographic demonstration, not
 * an interactive experiment.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { EntryCard, type EntryStatus } from "./EntryCard";
import { Mono } from "./Mono";
import { VerificationTicker } from "./VerificationTicker";
import { chainscanLinkLabel, networkLongLabel } from "@/lib/env";
import type { ProofResponse } from "@/lib/verify-proof";

const SEQUENTIAL_DELAY_MS = 220; // gap between per-entry verify fires
const AUTO_VERIFY_INITIAL_DELAY_MS = 600; // breathing room before badges start flipping

/**
 * Per-entry verify result shape — matches the GET
 * /api/verify/<id>/entry/<seq> response and `verifyEntryClient`.
 */
interface VerifyEntryResult {
  verified: "verified" | "unverified" | "unsigned";
  reason?: string;
}

/**
 * Plaintext path: server-side verification via the existing /entry/<seq> route.
 * Encrypted path: EncryptedReveal injects a client-side ethers verifier.
 */
type VerifyEntryFn = (entry: {
  seq: number;
  outputHash: string;
  teeSignature?: string;
  agentId?: string;
  sealId?: string;
  signedAt?: number;
}) => Promise<VerifyEntryResult>;

export function SessionView({
  proof,
  verifyEntry,
}: {
  proof: ProofResponse;
  /**
   * Optional per-entry verify callback. When provided, SessionView uses
   * it instead of fetching /api/verify/<id>/entry/<seq>. Set by
   * EncryptedReveal for v0.3.0 encrypted receipts so verification stays
   * fully client-side (the reveal key never leaves the browser).
   */
  verifyEntry?: VerifyEntryFn;
}) {
  // `entries` is optional on ProofResponse now (locked encrypted receipts
  // omit it). SessionView only renders when entries are present — the
  // caller (page.tsx or EncryptedReveal-decrypted-state) is responsible
  // for not handing us a locked proof.
  const entries = proof.entries ?? [];
  const [statuses, setStatuses] = useState<EntryStatus[]>(() =>
    entries.map(() => ({ state: "pending" })),
  );
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startedRef = useRef(false);

  const verifyOnChain = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    setCompleted(false);

    for (let i = 0; i < entries.length; i++) {
      setStatuses((s) => {
        const next = [...s];
        next[i] = { state: "verifying" };
        return next;
      });
      const entry = entries[i]!;
      try {
        let result: VerifyEntryResult;
        if (verifyEntry !== undefined) {
          result = await verifyEntry({
            seq: entry.seq,
            outputHash: entry.outputHash,
            teeSignature: entry.teeSignature,
            agentId: entry.agentId,
            sealId: entry.sealId,
            signedAt: entry.signedAt,
          });
        } else {
          // Plaintext path: hit the server route. Uses entry.seq (NOT
          // the array index) — the API resolves entries by
          // `seqNum === entry.seq`, so a session with non-contiguous
          // sequence numbers would silently 404 every entry under
          // the index-based URL. (Codex bot round-11 P2 on PR #23.)
          const res = await fetch(
            `/api/verify/${proof.tokenId}/entry/${entry.seq}`,
            { cache: "no-store" },
          );
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: { message?: string };
            };
            result = {
              verified: "unverified",
              reason: body.error?.message ?? `HTTP ${res.status}`,
            };
          } else {
            result = (await res.json()) as VerifyEntryResult;
          }
        }
        setStatuses((s) => {
          const next = [...s];
          next[i] =
            result.verified === "unverified"
              ? { state: "unverified", reason: result.reason }
              : { state: result.verified };
          return next;
        });
      } catch (e) {
        setStatuses((s) => {
          const next = [...s];
          next[i] = {
            state: "unverified",
            reason: e instanceof Error ? e.message : String(e),
          };
          return next;
        });
      }
      await new Promise((r) => setTimeout(r, SEQUENTIAL_DELAY_MS));
    }

    setRunning(false);
    setCompleted(true);
    startedRef.current = false; // permit replay
  }, [proof.tokenId, entries, verifyEntry]);

  // AUTO-VERIFY on mount — the bold move. Empty deps so the effect
  // runs exactly once per mount; startedRef inside verifyOnChain
  // prevents StrictMode's double-invoke from firing the cascade twice.
  // (Earlier version gated on a useState flag and put it in deps —
  // the dependency change re-ran the effect, whose cleanup cancelled
  // the pending setTimeout before it could fire. Caught via Playwright,
  // 2026-05-06.)
  useEffect(() => {
    const handle = setTimeout(() => {
      void verifyOnChain();
    }, AUTO_VERIFY_INITIAL_DELAY_MS);
    return () => clearTimeout(handle);
    // verifyOnChain intentionally NOT in deps — its identity is stable
    // (only depends on tokenId + entry count) and adding it would
    // reintroduce the cleanup-cancels-cascade bug above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allVerified = completed && statuses.every((s) => s.state === "verified");
  const anyFailed = completed && statuses.some((s) => s.state === "unverified");
  const tickerEntries = entries.map((e, i) => ({
    seq: e.seq,
    tool: e.tool,
    status: statuses[i] ?? { state: "pending" as const },
  }));

  return (
    <>
      <VerificationTicker entries={tickerEntries} />
      <div className="relative mx-auto mt-6 max-w-5xl space-y-8 px-4 pb-16 sm:mt-8 sm:space-y-10 sm:px-6">
        <NumericHero
          proof={proof}
          running={running}
          completed={completed}
          allVerified={allVerified}
          anyFailed={anyFailed}
          onReplay={verifyOnChain}
        />
        <SessionRecord proof={proof} />
        <EntryChain proof={proof} statuses={statuses} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Numeric hero — the brand mark                                      */
/* ------------------------------------------------------------------ */

function NumericHero({
  proof,
  running,
  completed,
  allVerified,
  anyFailed,
  onReplay,
}: {
  proof: ProofResponse;
  running: boolean;
  completed: boolean;
  allVerified: boolean;
  anyFailed: boolean;
  onReplay: () => void;
}) {
  return (
    <header className="relative grid grid-cols-1 items-end gap-8 lg:grid-cols-[auto_1fr_auto]">
      {/* Massive numeric tokenId — the brand mark of the proof. */}
      <div className="relative">
        <div
          className="token-stamp font-mono text-[80px] leading-none text-text-primary sm:text-[120px] md:text-[160px]"
          aria-label={`Token ${proof.tokenId}`}
        >
          <span className="text-text-secondary/40">#</span>
          {proof.tokenId}
        </div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
          AgenticID iNFT · {networkLongLabel(proof.meta.chainId)} ·
          chainId {proof.meta.chainId}
        </div>
      </div>

      {/* Session metadata column */}
      <div className="grid grid-cols-1 gap-y-3 self-end font-mono text-xs sm:grid-cols-[auto_1fr]">
        <FieldRow label="Session" value={<Mono copy>{proof.sessionId}</Mono>} />
        <FieldRow
          label="Description"
          value={<span className="text-text-primary">{proof.meta.dataDescription}</span>}
        />
        <FieldRow
          label="Anchor"
          value={
            <Mono truncate={28} copy>
              {proof.rootHash}
            </Mono>
          }
        />
        <FieldRow
          label="Entries"
          value={<span className="text-text-primary">{proof.entryCount}</span>}
        />
      </div>

      {/* Replay control. Auto-verify already fires on mount; this is
          for re-running. Subtle by default; only "loud" on failure. */}
      <div className="flex flex-col items-start lg:items-end">
        <button
          type="button"
          onClick={onReplay}
          disabled={running}
          className={
            "inline-flex items-center justify-center gap-2 rounded-none border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-all " +
            (running
              ? "cursor-wait border-border/60 text-text-secondary"
              : completed && allVerified
                ? "border-accent-verify/50 text-accent-verify hover:bg-accent-verify/10"
                : completed && anyFailed
                  ? "border-accent-unverified text-accent-unverified hover:bg-accent-unverified/10"
                  : "border-text-primary text-text-primary hover:bg-text-primary hover:text-bg")
          }
        >
          {running ? (
            <>
              <span className="h-2 w-2 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
              Auto-verifying {proof.entryCount}
            </>
          ) : completed && allVerified ? (
            <>↺ Replay verification</>
          ) : completed && anyFailed ? (
            <>↺ Re-run failed verification</>
          ) : (
            // Pre-cascade label matches the running state — the page
            // auto-fires within 600ms of mount, so there's no window
            // where the user sees a static "click me" CTA. (Caught in
            // design review, 2026-05-06: was "Verify on chain ↻" which
            // implied a click-to-trigger affordance contradicting the
            // auto-fire behavior.)
            <>
              <span className="h-2 w-2 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
              Auto-verifying {proof.entryCount}
            </>
          )}
        </button>
        <p className="mt-2 max-w-[180px] text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
          Auto-verifies on arrival
        </p>
      </div>
    </header>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <>
      <dt className="border-r border-border/40 pr-4 uppercase tracking-[0.14em] text-text-secondary">
        {label}
      </dt>
      <dd className="break-all pl-4">{value}</dd>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Session record — official-document strip with explorer links      */
/* ------------------------------------------------------------------ */

function SessionRecord({ proof }: { proof: ProofResponse }) {
  return (
    <section className="perforated-border pb-6">
      <div className="grid grid-cols-1 gap-x-12 gap-y-3 font-mono text-[11px] sm:grid-cols-2">
        {/* "Filed" cell removed: we don't have the mint timestamp /
            block in the API yet (would require an extra event query
            against AgenticID's IntelligentDataSet log). Hardcoding a
            static value would be a credibility leak in a verifier
            app — caught in design review, 2026-05-06. Re-add when
            ProofResponse.meta gains mintedAt + blockNumber. */}
        <RecordCell
          label="Storage anchor"
          value={
            <Link
              href={proof.meta.storageUrl}
              className="text-link hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {proof.meta.chainId === 16661
                ? "indexer-storage ↗"
                : "indexer-storage-testnet ↗"}
            </Link>
          }
          sub="proof: true · merkle-verified"
        />
        <RecordCell
          label="On-chain"
          value={
            <Link
              // Defensive: older API shapes (before the explorer-meta
              // refactor) may not include `meta.explorer` — fall back to
              // a chainscan URL with the Epic-7 AgenticID. New verify-proof
              // shapes ALWAYS include `meta.explorer.token`; this fallback
              // exists only for cached old responses.
              href={
                proof.meta.explorer?.token ??
                `https://chainscan-galileo.0g.ai/token/0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38?a=${proof.tokenId}`
              }
              className="text-link hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {chainscanLinkLabel(proof.meta.chainId)}
            </Link>
          }
          sub="ERC-7857 · IntelligentDataSet"
        />
      </div>
    </section>
  );
}

function RecordCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
}) {
  return (
    <div>
      <p className="uppercase tracking-[0.18em] text-text-secondary">{label}</p>
      <p className="mt-1 text-text-primary">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-text-secondary">
        {sub}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EntryChain — vertical line + cards. The chain reads as a chain.   */
/* ------------------------------------------------------------------ */

function EntryChain({
  proof,
  statuses,
}: {
  proof: ProofResponse;
  statuses: EntryStatus[];
}) {
  // `entries` is optional on ProofResponse (encrypted-locked omits it).
  // EntryChain only renders the cards when entries exist; locked
  // receipts are handled by the EncryptedReveal wrapper, not here.
  const entries = proof.entries ?? [];
  return (
    <section>
      <header className="mb-6 flex items-baseline justify-between">
        <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.18em] text-text-primary">
          Tool calls · {entries.length}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
          Each step verified independently
        </span>
      </header>
      <div className="relative">
        {/* The vertical chain backbone — sits to the left of every
            card. Solid 1px line in border color, with each card's
            node marker drawn over it. */}
        <div
          aria-hidden="true"
          className="absolute bottom-4 left-[11px] top-4 w-px bg-border sm:left-[15px]"
        />
        <ol className="min-w-0 space-y-4">
          {entries.map((entry, i) => {
            const status = statuses[i] ?? { state: "pending" as const };
            return (
              <li key={entry.seq} className="relative min-w-0 pl-8 sm:pl-12">
                <ChainNode status={status} />
                <EntryCard
                  seq={entry.seq}
                  ts={entry.ts}
                  type={entry.type}
                  tool={entry.tool}
                  inputHash={entry.inputHash}
                  outputHash={entry.outputHash}
                  hasTeeSignature={entry.hasTeeSignature}
                  params={entry.params}
                  result={entry.result}
                  status={status}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function ChainNode({ status }: { status: EntryStatus }) {
  const tone =
    status.state === "verified"
      ? "border-accent-verify bg-accent-verify"
      : status.state === "unverified"
        ? "border-accent-unverified bg-accent-unverified"
        : status.state === "verifying"
          ? "border-text-primary bg-bg animate-pulse"
          : status.state === "unsigned"
            ? "border-accent-mock bg-bg"
            : "border-border bg-bg";
  return (
    <span
      aria-hidden="true"
      className={
        "absolute left-[4px] top-6 h-3.5 w-3.5 rounded-full border-2 transition-colors duration-300 sm:left-[8px] " +
        tone
      }
    />
  );
}
