/**
 * /agent/[address] — every session by one agent. Sibling of Etherscan's
 * /address/0x... view, but for AI agent runs.
 *
 * Server component. Validates the address shape, fetches all
 * exec-log tokens owned by it, and renders an agent header
 * (truncated address, total session count) + the same FeedTable
 * primitive the landing page uses.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedTable } from "@/components/FeedTable";
import { Mono } from "@/components/Mono";
import { TopBar } from "@/components/TopBar";
import { fetchTokensForAgent, type FeedRow } from "@/lib/feed";
import { addressUrl } from "@/lib/explorer";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;

export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!ADDRESS_RE.test(address)) notFound();

  let rows: FeedRow[];
  try {
    rows = await fetchTokensForAgent(address);
  } catch {
    rows = [];
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <header className="border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
            Agent profile
          </p>
          <h1 className="mt-2 break-all font-mono text-2xl font-medium tabular-nums text-text-primary md:text-3xl">
            <Mono copy>{address}</Mono>
          </h1>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 font-mono text-sm">
            <span>
              <span className="text-text-secondary">Sessions: </span>
              <span className="text-text-primary">{rows.length}</span>
              {rows.length === 50 && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-text-secondary">
                  (limit reached)
                </span>
              )}
            </span>
            <a
              href={addressUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              View on Galileo explorer ↗
            </a>
          </div>
        </header>
        <section className="mt-10">
          <FeedTable initialRows={rows} />
        </section>
        {rows.length === 0 && (
          <p className="mt-6 font-sans text-sm text-text-secondary">
            No anchored sessions found for this address. If this agent has been
            running with the verifiable-execution plugin, sessions appear here
            within ~30 seconds of each session_end. If not, install the plugin:{" "}
            <Link href="/" className="text-link hover:underline">
              ← back to landing
            </Link>
            .
          </p>
        )}
      </main>
    </div>
  );
}
