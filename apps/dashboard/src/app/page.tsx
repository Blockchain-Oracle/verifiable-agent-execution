/**
 * / — landing page. Editorial broadsheet feel: a tall hero block
 * (the pitch), a thin separator, then the live feed table.
 *
 * Server component. Fetches the initial feed payload for the
 * critical above-the-fold so the first paint is real data — no
 * skeleton flash. Client-side polling kicks in for new mints.
 */

import Link from "next/link";

import { FeedTable } from "@/components/FeedTable";
import { TopBar } from "@/components/TopBar";
import {
  DEMO_TOKEN_ID,
  chainscanHost,
  chainscanLinkLabel,
  loadEnv,
  networkLongLabel,
  shortAddress,
} from "@/lib/env";
import { fetchRecentFeed, type FeedRow } from "@/lib/feed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initialRows: FeedRow[];
  try {
    initialRows = await fetchRecentFeed();
  } catch {
    initialRows = [];
  }
  const env = loadEnv();

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <Hero
          agenticIdAddress={env.AGENTICID_ADDRESS}
          chainId={env.CHAIN_ID}
        />
        <div className="mt-12">
          <FeedTable initialRows={initialRows} />
        </div>
        <Footer
          chainId={env.CHAIN_ID}
          agenticIdAddress={env.AGENTICID_ADDRESS}
          verifierAddress={env.TEE_VERIFIER_ADDRESS}
        />
      </main>
    </div>
  );
}

function Hero({
  agenticIdAddress,
  chainId,
}: {
  agenticIdAddress: string;
  chainId: number;
}) {
  // SCAMPER pass on the hero, 2026-05-15 (Tier 1.7).
  //
  // Eliminate — the "0G APAC Hackathon · Track 1 · Live on Galileo
  //   testnet" eyebrow was hackathon-internal. Judges already know
  //   they're on a hackathon submission, and the MainnetAnnouncement-
  //   Ticker above (Tier 1.6) carries the live-network signal.
  //
  // Substitute — the old subtitle stacked four jargon phrases
  //   ("TEE-signed log", "ERC-7857 iNFT", "AgenticID", "0G Storage")
  //   in 24 words; a judge from outside the crypto/0G ecosystem
  //   couldn't parse it. New copy leads with the user's experience
  //   ("every tool your agent runs becomes a signed receipt") and
  //   defers the architecture to the proof-chain aside.
  //
  // Substitute — the secondary "sample agent" link pointed at the
  //   deploy wallet, not at an actual mint-producing agent.
  //   Repointed at the bot wallet (the address that mints every
  //   receipt in the live feed).
  //
  // Substitute — the 4-step proof aside listed mechanism instead
  //   of value. Rewritten in plain language; each step now answers
  //   "what happens" from the user's vantage, not "how it's
  //   implemented" from ours.
  //
  // Magnify — added an "Encrypted by default" callout. The
  //   encrypted-by-default model (v0.3.0) is the wedge that
  //   distinguishes AGENTSCAN from any "agent observability" tool;
  //   omitting it from the hero buries the lede.
  return (
    <section className="grid gap-12 border-b border-border pb-12 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-verify">
          AGENTSCAN · BETA
        </p>
        <h1 className="mt-4 font-sans text-5xl font-bold leading-[1.05] tracking-tight text-text-primary md:text-6xl">
          Etherscan
          <br />
          for AI agents.
        </h1>
        <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-text-secondary">
          Every tool your agent runs — every search, file read, MCP call —
          becomes a signed, on-chain-anchored receipt. Share one URL.
          Anyone verifies the agent did exactly what it claimed.
          No wallet, no login, no setup.
        </p>
        <p className="mt-3 max-w-xl font-mono text-[11px] uppercase tracking-[0.14em] text-accent-verify">
          🔒 Encrypted by default · you control who sees the content
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href={`/verify/${DEMO_TOKEN_ID}`}
            className="group inline-flex items-center gap-2 rounded-md bg-accent-verify px-4 py-2.5 font-sans text-sm font-semibold text-bg transition-transform hover:translate-y-[-1px]"
          >
            Verify the demo session
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
          <Link
            href="/agent/0x8f173a582dde8CA95742c38852B202936126b1EB"
            className="font-mono text-xs uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
          >
            Browse the live demo bot →
          </Link>
        </div>
      </div>
      <aside className="rounded-md border border-border bg-surface p-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          How it works
        </h2>
        <ol className="mt-5 space-y-4 font-sans text-sm leading-relaxed text-text-primary">
          {[
            {
              step: "01",
              title: "Your agent runs as usual",
              detail:
                "Install our plugin in your OpenClaw config. From that moment, every tool call your agent makes is captured automatically — no code changes, no SDK to wire.",
            },
            {
              step: "02",
              title: "Every tool gets hashed + signed",
              detail:
                "Each search, file read, or MCP call becomes a signed entry. The agent itself can't tamper with it — signing happens outside its loop.",
            },
            {
              step: "03",
              title: "Anchored on 0G Chain",
              detail:
                "The full session log goes to 0G Storage encrypted. Its content hash gets minted as an iNFT receipt token you own.",
            },
            {
              step: "04",
              title: "Share a URL. Anyone verifies cold",
              detail:
                "Paste the link in any browser. The dashboard runs three live reads against the chain and storage. Five rows flip green.",
            },
          ].map((item) => (
            <li key={item.step} className="flex gap-4">
              <span className="font-mono text-[11px] tabular-nums leading-relaxed text-accent-verify">
                {item.step}
              </span>
              <div>
                <p className="font-semibold">{item.title}</p>
                <p className="text-text-secondary">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-border/60 pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
          Anchor contract: {shortAddress(agenticIdAddress)} · chainId {chainId}
        </p>
      </aside>
    </section>
  );
}

function Footer({
  chainId,
  agenticIdAddress,
  verifierAddress,
}: {
  chainId: number;
  agenticIdAddress: string;
  verifierAddress: string;
}) {
  // networkLongLabel returns "Aristotle mainnet" / "Galileo testnet";
  // Footer prefixes with "0G " and parenthesises the env qualifier so
  // the chip reads e.g. "0G Aristotle (mainnet)" — but the FOOTER text
  // is uppercased via Tailwind's tracking class so judges see
  // "0G ARISTOTLE (MAINNET)" matching the BDD's exact-text criterion.
  // (Codex pre-push: BDD specifies (MAINNET)/(TESTNET) uppercase.)
  const networkLabel = `0G ${networkLongLabel(chainId).replace(/ (mainnet|testnet)$/, (_m, env) => ` (${env.toUpperCase()})`)}`;
  const explorerHost = chainscanHost(chainId);
  const explorerLabel = chainscanLinkLabel(chainId);
  return (
    <footer className="mt-16 flex flex-wrap items-baseline justify-between gap-4 border-t border-border pt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
      <div>
        Anchored on {networkLabel} · chainId {chainId} · AgenticID{" "}
        {shortAddress(agenticIdAddress)} · MockTEEVerifier{" "}
        {shortAddress(verifierAddress)}
      </div>
      <a
        href={explorerHost}
        target="_blank"
        rel="noreferrer"
        className="hover:text-text-primary"
      >
        {explorerLabel}
      </a>
    </footer>
  );
}
