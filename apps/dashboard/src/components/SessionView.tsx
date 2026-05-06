"use client";

/**
 * SessionView — the proof-chain detail page client surface. Wraps:
 *   - SessionHeader  (sessionId, agent, model, status pill, "Verify on chain" CTA)
 *   - EntryCard list (one per ExecutionLogEntry)
 *
 * Drives the sequential badge-flip animation per the PRD reverse-arc:
 * "click Verify on chain → 4 row badges flip from grey to TEE Verified
 * ✓ in sequence". Each entry starts in `pending` state; on click,
 * fires GET /api/verify/[tokenId]/entry/[seq] one at a time, with
 * a brief delay between, so the user sees the flip cadence.
 */

import Link from "next/link";
import { useCallback, useState } from "react";

import { Mono } from "./Mono";
import { EntryCard, type EntryStatus } from "./EntryCard";
import type { ProofResponse } from "@/lib/verify-proof";

const SEQUENTIAL_DELAY_MS = 220; // gap between per-entry verify fires

export function SessionView({ proof }: { proof: ProofResponse }) {
  const [statuses, setStatuses] = useState<EntryStatus[]>(() =>
    proof.entries.map(() => ({ state: "pending" })),
  );
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);

  const verifyOnChain = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setCompleted(false);

    for (let i = 0; i < proof.entries.length; i++) {
      setStatuses((s) => {
        const next = [...s];
        next[i] = { state: "verifying" };
        return next;
      });
      try {
        const res = await fetch(`/api/verify/${proof.tokenId}/entry/${i}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          setStatuses((s) => {
            const next = [...s];
            next[i] = {
              state: "unverified",
              reason: body.error?.message ?? `HTTP ${res.status}`,
            };
            return next;
          });
        } else {
          const body = (await res.json()) as {
            verified: "verified" | "unverified" | "unsigned";
            reason?: string;
          };
          setStatuses((s) => {
            const next = [...s];
            next[i] = body.verified === "unverified"
              ? { state: "unverified", reason: body.reason }
              : { state: body.verified };
            return next;
          });
        }
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
      // Pacing: brief delay before kicking off the next entry so the
      // animation reads as sequential, not a single instant flash.
      await new Promise((r) => setTimeout(r, SEQUENTIAL_DELAY_MS));
    }

    setRunning(false);
    setCompleted(true);
  }, [proof.tokenId, proof.entries.length, running]);

  const allVerified = statuses.every((s) => s.state === "verified");
  const anyFailed = statuses.some((s) => s.state === "unverified");

  return (
    <div className="space-y-8">
      <SessionHeader
        proof={proof}
        running={running}
        completed={completed}
        allVerified={allVerified}
        anyFailed={anyFailed}
        onVerify={verifyOnChain}
      />
      <section className="space-y-4">
        <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.16em] text-text-primary">
          Tool calls · {proof.entries.length}
        </h2>
        <div className="space-y-3">
          {proof.entries.map((entry, i) => (
            <EntryCard
              key={entry.seq}
              seq={entry.seq}
              ts={entry.ts}
              type={entry.type}
              tool={entry.tool}
              inputHash={entry.inputHash}
              outputHash={entry.outputHash}
              hasTeeSignature={entry.hasTeeSignature}
              params={entry.params}
              result={entry.result}
              status={statuses[i] ?? { state: "pending" }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SessionHeader({
  proof,
  running,
  completed,
  allVerified,
  anyFailed,
  onVerify,
}: {
  proof: ProofResponse;
  running: boolean;
  completed: boolean;
  allVerified: boolean;
  anyFailed: boolean;
  onVerify: () => void;
}) {
  return (
    <header className="rounded-md border border-border bg-surface">
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
            Session proof · token #{proof.tokenId}
          </p>
          <h1 className="break-words font-sans text-2xl font-semibold leading-tight text-text-primary md:text-3xl">
            {proof.sessionId}
          </h1>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 pt-2 font-mono text-xs sm:grid-cols-2">
            <Field label="Anchor">
              <Mono truncate={20} copy>
                {proof.rootHash}
              </Mono>
            </Field>
            <Field label="Entries">
              <span className="text-text-primary">{proof.entryCount}</span>
            </Field>
            <Field label="Description">
              <span className="text-text-primary">{proof.meta.dataDescription}</span>
            </Field>
            <Field label="ChainId">
              <span className="text-text-primary">{proof.meta.chainId}</span>
            </Field>
          </dl>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <button
            type="button"
            onClick={onVerify}
            disabled={running}
            className={`inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 font-sans text-sm font-semibold transition-all ${
              running
                ? "cursor-wait bg-surface-elev text-text-secondary"
                : completed && allVerified
                  ? "border border-accent-verify/40 bg-accent-verify/10 text-accent-verify"
                  : "bg-accent-verify text-bg hover:translate-y-[-1px]"
            }`}
          >
            {running && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
            )}
            {!running && completed && allVerified && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {running
              ? `Verifying ${proof.entryCount} step${proof.entryCount === 1 ? "" : "s"}…`
              : completed
                ? allVerified
                  ? "All verified — re-run"
                  : anyFailed
                    ? "Verification failed — re-run"
                    : "Re-run verification"
                : "Verify on chain"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary lg:text-right">
            Per-step calls to MockTEEVerifier ·{" "}
            <Link href="https://chainscan-galileo.0g.ai" className="text-link hover:underline">
              Galileo explorer ↗
            </Link>
          </p>
        </div>
      </div>
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="uppercase tracking-wider text-text-secondary">{label}</dt>
      <dd className="text-text-primary">{children}</dd>
    </div>
  );
}
