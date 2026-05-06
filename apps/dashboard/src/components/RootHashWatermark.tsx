/**
 * RootHashWatermark — the proof IS the watermark.
 *
 * Tiles the session's 64-char rootHash hex across the page background
 * at very low opacity (think of security paper / banknote watermark
 * patterns). The rootHash is the cryptographic anchor; making it
 * literally fill the visual field is the strongest possible "this
 * thing is anchored" signal.
 *
 * Implementation: a single absolutely-positioned div behind page
 * content. Uses CSS `repeat(...)` of the hex string in a tight grid.
 * Pointer-events-none so it never interferes with clicks.
 */

export function RootHashWatermark({ rootHash }: { rootHash: string }) {
  // Strip 0x prefix if present so the hex itself is what tiles.
  const text = rootHash.startsWith("0x") ? rootHash.slice(2) : rootHash;
  // Build a long string of repeated hash to fill rows; each row tiles
  // the hash horizontally. We render N rows, each offset by half a
  // hash-width so the grid doesn't form vertical seams.
  const rows = 32;
  const repeatPerRow = 4;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-0 overflow-hidden select-none"
    >
      <div className="absolute inset-0 flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tabular-nums leading-[1.8] tracking-[0.05em] text-accent-verify/[0.04]"
            style={{
              transform: `translateX(${(i % 2 === 0 ? 0 : -50)}px)`,
            }}
          >
            {Array.from({ length: repeatPerRow }).map((_, j) => (
              <span key={j} className="px-3">
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
      {/* Vignette so content stays readable in the center-vertical band */}
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-bg/60 to-bg" />
    </div>
  );
}
