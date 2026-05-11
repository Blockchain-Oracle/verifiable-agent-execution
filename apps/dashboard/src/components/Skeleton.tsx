/**
 * Skeleton — animated placeholder rows for the proof loading state.
 *
 * UX spec acceptance for verifier-ui: "When the API has not returned
 * yet, then at least 4 skeleton cards or shimmer placeholders are
 * visible AND the page does not flash unstyled content."
 *
 * Renders one header skeleton + four card skeletons by default. The
 * shimmer animation is via Tailwind's `animate-pulse` — no extra
 * keyframes required, no client JS.
 */

export function ProofChainSkeleton() {
  return (
    <section className="space-y-6" aria-busy="true">
      <header className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-3 w-16 animate-pulse rounded bg-surface-elev" />
            <div className="h-7 w-72 animate-pulse rounded bg-surface-elev" />
            <div className="h-4 w-40 animate-pulse rounded bg-surface-elev" />
          </div>
          <div className="h-7 w-28 animate-pulse rounded-full bg-surface-elev" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-surface-elev" />
              <div className="h-4 w-full animate-pulse rounded bg-surface-elev" />
            </div>
          ))}
        </div>
      </header>

      <section className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <article
            key={i}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <div className="h-3 w-12 animate-pulse rounded bg-surface-elev" />
                <div className="h-4 w-32 animate-pulse rounded bg-surface-elev" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-surface-elev" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="h-3 w-full animate-pulse rounded bg-surface-elev" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-elev" />
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
