/**
 * Landing page — minimal placeholder pointing visitors at the
 * /verify/[tokenId] route. The reverse demo arc (per ADR-11) means
 * judges enter cold with a verifyUrl in hand; they shouldn't need to
 * navigate this landing page first. Keeping it intentionally sparse
 * so the proof-detail page is the focal artifact.
 */

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">
        Verifiable Agent Execution
      </h1>
      <p className="mt-4 text-text-secondary">
        Etherscan for AI agents. Share a URL, verify any agent run cold —
        no wallet, no account, no trust required.
      </p>
      <div className="mt-12 rounded-lg border border-border bg-surface p-6">
        <p className="text-sm text-text-secondary">
          Open a proof at{" "}
          <code className="rounded bg-surface-elev px-2 py-0.5 font-mono text-sm text-text-primary">
            /verify/&lt;tokenId&gt;
          </code>
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Three live reads — AgenticID intelligent data → 0G Storage download →
          TEEVerifier signature recovery — flip green checkmarks per row.
        </p>
      </div>
    </main>
  );
}
