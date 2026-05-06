/**
 * /verify/[tokenId] — public proof-chain detail page.
 *
 * Server component. Resolves the proof, then hands off to SessionView
 * (client component) which drives the badge-flip animation. The page
 * itself does NOT pre-verify each entry — initial render shows ALL
 * badges as "Awaiting verify"; the user clicks "Verify on chain" and
 * watches them flip green-by-green. That click + flip IS the wedge.
 *
 * Three failure paths render dedicated error messages:
 *   - 404 (token doesn't exist / no exec-log anchor)
 *   - 422 (malformed dataDescription / blob)
 *   - 502 (chain or storage RPC failure)
 *
 * Reverse-demo arc per ADR-11: page works COLD on first paint for a
 * judge with no setup.
 */

import Link from "next/link";

import { Mono } from "@/components/Mono";
import { SessionView } from "@/components/SessionView";
import { TopBar } from "@/components/TopBar";
import {
  ProofResolutionError,
  resolveProof,
  type ProofResponse,
} from "@/lib/verify-proof";

type PageProps = {
  params: Promise<{ tokenId: string }>;
};

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: PageProps) {
  const { tokenId } = await params;
  let proof: ProofResponse | null = null;
  let error: unknown = null;
  try {
    proof = await resolveProof(tokenId);
  } catch (e) {
    error = e;
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-10">
        {proof !== null ? (
          <SessionView proof={proof} />
        ) : (
          <ProofError cause={error} tokenId={tokenId} />
        )}
      </main>
    </div>
  );
}

function ProofError({ cause, tokenId }: { cause: unknown; tokenId: string }) {
  const isKnown = cause instanceof ProofResolutionError;
  const code = isKnown ? cause.code : "INTERNAL_SERVER_ERROR";
  const status = isKnown ? cause.status : 500;
  const message = isKnown
    ? cause.message
    : "Unexpected failure resolving proof. Check server logs.";

  const tone =
    status === 404
      ? { label: "Not found", color: "text-accent-mock", bg: "bg-accent-mock/10" }
      : { label: "Error", color: "text-accent-unverified", bg: "bg-accent-unverified/10" };

  return (
    <section className="rounded-md border border-border bg-surface p-8">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
            Token #{tokenId}
          </p>
          <h1 className="mt-2 font-sans text-2xl font-semibold text-text-primary">
            Proof resolution failed
          </h1>
        </div>
        <span
          className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${tone.color} ${tone.bg}`}
        >
          {tone.label}
        </span>
      </div>
      <p className="mt-6 font-sans text-sm leading-relaxed text-text-secondary">{message}</p>
      <dl className="mt-6 space-y-2 font-mono text-xs">
        <div className="flex justify-between gap-4">
          <dt className="uppercase tracking-wider text-text-secondary">Error code</dt>
          <dd>
            <Mono>{code}</Mono>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="uppercase tracking-wider text-text-secondary">HTTP status</dt>
          <dd>{status}</dd>
        </div>
      </dl>
      <div className="mt-8 flex gap-4 font-mono text-[11px] uppercase tracking-[0.14em]">
        <Link href="/" className="text-text-secondary hover:text-text-primary">
          ← Back to feed
        </Link>
        <Link href="/verify/98" className="text-link hover:underline">
          Try the demo session →
        </Link>
      </div>
    </section>
  );
}
