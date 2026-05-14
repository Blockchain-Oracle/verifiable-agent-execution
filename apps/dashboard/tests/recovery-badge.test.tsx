// recovery-badge.test.tsx — v0.3.4-15 UI BDD coverage (Codex r5 close).
//
// Renders SessionView and FeedTable via react-dom/server's pure-
// function renderToStaticMarkup to assert the orphan-recovery
// badges appear when recoveryAnchor === true. No jsdom / RTL needed:
// renderToStaticMarkup runs the initial render synchronously, fires
// hook initializers but NOT effects, and returns the HTML string. For
// a conditional badge driven purely by props, this is sufficient.
//
// Why this file is .tsx: vitest's include glob is extended in
// vitest.config.ts to pick up the .test.tsx pattern, and React's
// automatic JSX runtime handles the syntax.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Env vars MUST be set before any import that pulls in env.ts at
// module load (FeedTable does this transitively via feed.ts).
process.env.ZG_TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
process.env.ZG_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
process.env.AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
process.env.CHAIN_ID = "16602";

import { FeedTable } from "@/components/FeedTable";
import { SessionView } from "@/components/SessionView";
import type { FeedRow } from "@/lib/feed";
import type { ProofResponse } from "@/lib/verify-proof";

const VALID_HASH = `0x${"a".repeat(64)}`;

function makeProof(overrides: {
  recoveryAnchor: boolean;
  dataDescription: string;
}): ProofResponse {
  return {
    tokenId: "42",
    sessionId: "ses_render_test",
    rootHash: VALID_HASH,
    entryCount: 1,
    verified: "preview",
    entries: [
      {
        seq: 0,
        ts: 1700000000000,
        type: "tool_call",
        tool: "noop",
        inputHash: "a".repeat(64),
        outputHash: "b".repeat(64),
        hasTeeSignature: false,
      },
    ],
    meta: {
      chainId: 16602,
      dataDescription: overrides.dataDescription,
      recoveryAnchor: overrides.recoveryAnchor,
      storageUrl: "https://indexer-storage-testnet-turbo.0g.ai/file/" + VALID_HASH,
      explorer: {
        token: "https://chainscan-galileo.0g.ai/token/0xabc?a=42",
        contract: "https://chainscan-galileo.0g.ai/address/0xabc",
        verifierContract: "https://chainscan-galileo.0g.ai/address/0xdef",
      },
      faucetUrl: "https://faucet.0g.ai",
      rpcUrl: "https://evmrpc-testnet.0g.ai",
      verifierAddress: `0x${"a".repeat(40)}`,
    },
  };
}

function makeFeedRow(recoveryAnchor: boolean): FeedRow {
  return {
    tokenId: "42",
    owner: `0x${"b".repeat(40)}`,
    dataDescription: recoveryAnchor
      ? "exec-log-orphan:ses_feed_test:claude-sonnet-4-6"
      : "exec-log:ses_feed_test:claude-sonnet-4-6",
    sessionId: "ses_feed_test",
    modelId: "claude-sonnet-4-6",
    rootHash: VALID_HASH,
    recoveryAnchor,
  };
}

describe("SessionView — recovery badge (v0.3.4-15)", () => {
  it("renders 'Orphan recovery anchor' when proof.meta.recoveryAnchor === true", () => {
    const html = renderToStaticMarkup(
      createElement(SessionView, {
        proof: makeProof({
          recoveryAnchor: true,
          dataDescription: "exec-log-orphan:ses_render_test:claude-sonnet-4-6",
        }),
      }),
    );
    expect(html).toContain("Orphan recovery anchor");
  });

  it("does NOT render 'Orphan recovery anchor' when proof.meta.recoveryAnchor === false", () => {
    const html = renderToStaticMarkup(
      createElement(SessionView, {
        proof: makeProof({
          recoveryAnchor: false,
          dataDescription: "exec-log:ses_render_test:claude-sonnet-4-6",
        }),
      }),
    );
    expect(html).not.toContain("Orphan recovery anchor");
  });
});

describe("FeedTable — recovery badge (v0.3.4-15)", () => {
  it("renders 'Recovery' badge in the row when row.recoveryAnchor === true", () => {
    const html = renderToStaticMarkup(
      createElement(FeedTable, {
        initialRows: [makeFeedRow(true)],
      }),
    );
    // The "Anchored" status badge appears on EVERY row regardless;
    // the orphan-recovery row also carries the "Recovery" badge.
    expect(html).toContain("Anchored");
    expect(html).toContain("Recovery");
  });

  it("does NOT render the 'Recovery' badge for a normal row (recoveryAnchor === false)", () => {
    const html = renderToStaticMarkup(
      createElement(FeedTable, {
        initialRows: [makeFeedRow(false)],
      }),
    );
    expect(html).toContain("Anchored");
    expect(html).not.toContain("Recovery");
  });
});
