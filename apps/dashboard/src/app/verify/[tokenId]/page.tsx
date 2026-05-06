/**
 * /verify/[tokenId] — public proof-chain detail page.
 *
 * Server component — runs entirely on the Node runtime, fetches the
 * proof on each request via `resolveProof` (NOT through the
 * `/api/verify/[tokenId]` HTTP route — that route is for external
 * clients; calling it from the page would add an unnecessary
 * intra-process HTTP hop). The Suspense boundary renders the
 * Skeleton while the chain + storage reads are in flight.
 *
 * Three failure paths render dedicated error messages instead of
 * Next.js's default 500 page:
 *   - 404 (token doesn't exist / no exec-log anchor)
 *   - 422 (malformed dataDescription / invalid blob)
 *   - 502 (chain or storage RPC failure)
 *
 * The reverse-demo arc (per ADR-11) means this page MUST work cold
 * for a judge who arrived via a shared verifyUrl — no error message
 * may say "you don't have permission" or "log in" because the
 * dashboard has no auth surface.
 */

import { Suspense } from "react";

import { ProofChain } from "@/components/ProofChain";
import { ProofChainSkeleton } from "@/components/Skeleton";
import { ProofResolutionError, resolveProof, type ProofResponse } from "@/lib/verify-proof";

type PageProps = {
  params: Promise<{ tokenId: string }>;
};

export default function VerifyPage({ params }: PageProps) {
  // Wrap the proof resolution in Suspense so the Skeleton renders
  // immediately while the chain + storage reads are pending. The
  // ProofChainResolver child is the actual async server component.
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Suspense fallback={<ProofChainSkeleton />}>
        <ProofChainResolver params={params} />
      </Suspense>
    </main>
  );
}

async function ProofChainResolver({ params }: PageProps) {
  const { tokenId } = await params;
  let proof: ProofResponse;
  try {
    proof = await resolveProof(tokenId);
  } catch (cause) {
    return <ProofError cause={cause} tokenId={tokenId} />;
  }
  return <ProofChain proof={proof} />;
}

function ProofError({ cause, tokenId }: { cause: unknown; tokenId: string }) {
  const isKnown = cause instanceof ProofResolutionError;
  const code = isKnown ? cause.code : "INTERNAL_SERVER_ERROR";
  const message = isKnown
    ? cause.message
    : "Unexpected failure resolving proof. Check server logs.";

  // Map status to a UX-spec accent so the user sees the right severity
  // at a glance: 404 → mock (amber), 4xx other → unverified (red),
  // 5xx → unverified (red). The badge palette is consistent with
  // StatusBadge.
  const tone =
    isKnown && cause.status === 404
      ? { label: "Not Found", color: "text-accent-mock", bg: "bg-accent-mock/15" }
      : { label: "Error", color: "text-accent-unverified", bg: "bg-accent-unverified/15" };

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Proof for token #{tokenId}
        </h1>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${tone.color} ${tone.bg}`}
        >
          {tone.label}
        </span>
      </div>
      <p className="mt-4 break-words text-sm text-text-secondary">{message}</p>
      <p className="mt-4 font-mono text-xs text-text-secondary">code: {code}</p>
    </section>
  );
}
