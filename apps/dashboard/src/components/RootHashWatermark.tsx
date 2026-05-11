/**
 * RootHashWatermark — the proof IS the watermark.
 *
 * Tiles the session's 64-char rootHash hex across the page background
 * at very low opacity (think of security paper / banknote watermark
 * patterns). The rootHash is the cryptographic anchor; making it
 * literally fill the visual field is the strongest possible "this
 * thing is anchored" signal.
 *
 * Implementation: SVG-as-background-image, NOT rendered text. Earlier
 * versions tiled `<span>` elements with the hex inside, but that
 * leaked the hash into `document.body.innerText`, polluting Ctrl+F,
 * copy-paste, and screen readers (caught via Playwright, 2026-05-06).
 * Encoding the watermark as a background-image SVG keeps the visual
 * but removes the text from the DOM entirely.
 */

const ACCENT_VERIFY = "#10B981";

export function RootHashWatermark({ rootHash }: { rootHash: string }) {
  // Strip 0x prefix if present so the hex itself is what tiles.
  const text = rootHash.startsWith("0x") ? rootHash.slice(2) : rootHash;
  // Single tile = one row of the hex. We let CSS `background-repeat`
  // tile it both axes. Tile dimensions chosen so the hex reads at the
  // designed size (10px) with comfortable letter-spacing.
  const tileWidth = 760;
  const tileHeight = 22;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tileWidth}' height='${tileHeight}' viewBox='0 0 ${tileWidth} ${tileHeight}'><text x='0' y='15' fill='${ACCENT_VERIFY}' fill-opacity='0.05' font-family='ui-monospace, SFMono-Regular, monospace' font-size='10' letter-spacing='1' style='text-transform:uppercase'>${text.toUpperCase()}</text></svg>`;
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-0 select-none"
      style={{
        backgroundImage: dataUri,
        backgroundRepeat: "repeat",
        // No vignette gradient — earlier version layered a from-bg
        // gradient on top, which fought with the content's own bg-bg
        // and washed the watermark out almost entirely. The 5%-alpha
        // accent-verify text already reads as "background grain" on
        // the dark surface; let it speak for itself.
      }}
    />
  );
}
