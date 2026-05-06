/**
 * ProofChain — top-level proof-detail container.
 *
 * Layout (matches Trigger.dev run-detail anchor — left header with
 * primary identity, right column with status badge):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Session sessionId             [TEE Verified / Mock / X] │
 *   │ Token #N · agent <hash> · model <id>                    │
 *   │ Anchored on chain 16602 · 0G Storage rootHash <hash>    │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ <LogEntry seq=000 …>                                    │
 *   │ <LogEntry seq=001 …>                                    │
 *   │ …                                                        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Server component (no client-side state). The page-level loading
 * skeleton is rendered via Suspense in page.tsx instead of a useState
 * loading flag.
 */

import type { ProofResponse } from "@/lib/verify-proof";

import { LogEntry } from "./LogEntry";
import { StatusBadge } from "./StatusBadge";

type ProofChainProps = {
  proof: ProofResponse;
};

export function ProofChain({ proof }: ProofChainProps) {
  return (
    <section className="space-y-6">
      <header className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-secondary">
              Session
            </p>
            <h1 className="mt-1 break-all font-mono text-xl text-text-primary">
              {proof.sessionId}
            </h1>
            <p className="mt-3 text-sm text-text-secondary">
              <span className="font-mono text-text-primary">Token #{proof.tokenId}</span>
              <span className="mx-2 text-border">·</span>
              <span className="font-mono">{proof.entryCount}</span> {proof.entryCount === 1 ? "entry" : "entries"}
            </p>
          </div>
          <StatusBadge status={proof.verified} />
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-text-secondary">rootHash (0G Storage)</dt>
            <dd className="mt-1 break-all font-mono text-text-primary">{proof.rootHash}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">dataDescription</dt>
            <dd className="mt-1 break-all font-mono text-text-primary">
              {proof.meta.dataDescription}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">chainId</dt>
            <dd className="mt-1 font-mono text-text-primary">{proof.meta.chainId}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">storage url</dt>
            <dd className="mt-1 break-all">
              <a
                href={proof.meta.storageUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-link underline-offset-2 hover:underline"
              >
                {proof.meta.storageUrl}
              </a>
            </dd>
          </div>
        </dl>
      </header>

      <section aria-label="Execution log entries" className="space-y-3">
        {proof.entries.map((entry) => (
          <LogEntry key={entry.seq} entry={entry} />
        ))}
        {proof.entries.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-secondary">
            This session was anchored with zero log entries — the
            agent ran but produced no captured tool calls.
          </p>
        )}
      </section>
    </section>
  );
}
