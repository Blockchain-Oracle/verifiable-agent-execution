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
import { fetchRecentFeed, type FeedRow } from "@/lib/feed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initialRows: FeedRow[];
  try {
    initialRows = await fetchRecentFeed();
  } catch {
    initialRows = [];
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <Hero />
        <div className="mt-12">
          <FeedTable initialRows={initialRows} />
        </div>
        <Footer />
      </main>
    </div>
  );
}

function Hero() {
  return (
    <section className="grid gap-12 border-b border-border pb-12 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-verify">
          0G APAC Hackathon · Track 1 · Live on Galileo testnet
        </p>
        <h1 className="mt-4 font-sans text-5xl font-bold leading-[1.05] tracking-tight text-text-primary md:text-6xl">
          Etherscan
          <br />
          for AI agents.
        </h1>
        <p className="mt-6 max-w-xl font-sans text-base leading-relaxed text-text-secondary">
          Every OpenClaw agent session produces a TEE-signed log on 0G Storage,
          anchored as an ERC-7857 iNFT on AgenticID. Share one URL — anyone
          verifies the agent ran exactly what it claimed, no wallet, no login.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/verify/98"
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
            href="/agent/0x3b566583b51DA4da8d95565212C96836f66433A3"
            className="font-mono text-xs uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
          >
            Inspect a sample agent →
          </Link>
        </div>
      </div>
      <aside className="rounded-md border border-border bg-surface p-6">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          The proof chain
        </h2>
        <ol className="mt-5 space-y-4 font-sans text-sm leading-relaxed text-text-primary">
          {[
            {
              step: "01",
              title: "Tool call captured",
              detail:
                "OpenClaw plugin observes every after_tool_call. No agent cooperation needed.",
            },
            {
              step: "02",
              title: "TEE-signed entry",
              detail:
                "agent-wrapper signs each step with its sealed key. Recovers to the deployed verifier.",
            },
            {
              step: "03",
              title: "0G Storage flush",
              detail: "Session log uploaded; rootHash computed via Merkle proof.",
            },
            {
              step: "04",
              title: "ERC-7857 mint",
              detail:
                "iNFT anchors {dataDescription, rootHash} on AgenticID at 0x2700F6A3...EF1F",
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
      </aside>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-16 flex flex-wrap items-baseline justify-between gap-4 border-t border-border pt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
      <div>
        Anchored on 0G Galileo · chainId 16602 · AgenticID 0x2700F6A3…EF1F ·
        MockTEEVerifier 0x6F96f378…3E8CE
      </div>
      <a
        href="https://chainscan-galileo.0g.ai"
        target="_blank"
        rel="noreferrer"
        className="hover:text-text-primary"
      >
        Galileo explorer ↗
      </a>
    </footer>
  );
}
