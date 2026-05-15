// entry-card-markdown.test.tsx — pins Tier 1.5 (Abu 2026-05-15):
//
//   1. Tool-result content that LOOKS like markdown (WebSearch results
//      with [text](URL) citations, lists, bold) gets rendered as HTML
//      with anchor tags + lists + bold, not as a wall of `*` characters.
//   2. JSON-like content (the existing decoded entry params/result) keeps
//      rendering as a monospace block — react-markdown would mangle it.
//   3. Long values (URLs, sessionKeys, paths) wrap inside the card
//      instead of triggering horizontal scroll. We test this by
//      checking the rendered classes — `whitespace-pre-wrap` and
//      `break-words` are both required; the legacy `overflow-x-auto`
//      MUST be absent on the plain path.
//
// Renders via react-dom/server's renderToStaticMarkup (same pattern as
// recovery-badge.test.tsx — no jsdom needed for pure JSX).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntryCard } from "@/components/EntryCard";

const VALID_HASH = `0x${"a".repeat(64)}`;

function makeEntryProps(overrides: {
  params?: unknown;
  result?: unknown;
  tool?: string;
}) {
  return {
    seq: 0,
    ts: 1700000000000,
    type: "tool_call",
    tool: overrides.tool ?? "WebSearch",
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
    hasTeeSignature: true,
    params: overrides.params,
    result: overrides.result,
    status: { state: "pending" as const },
  };
}

describe("EntryCard — markdown rendering (v0.3.7 Tier 1.5)", () => {
  it("renders a tool_result string as markdown when it has structural signals", () => {
    // Realistic WebSearch result content: header + bullets + link.
    const markdownResult =
      "## SOL price\n\n- Current: $93.42\n- 24h: +1.8%\n\nSource: [coingecko.com](https://www.coingecko.com/en/coins/solana)";
    const html = renderToStaticMarkup(
      createElement(EntryCard, makeEntryProps({ result: markdownResult })),
    );
    // The h2 + bullets + anchor tag should be in the output.
    expect(html).toMatch(/<h2[^>]*>SOL price<\/h2>/);
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www\.coingecko\.com\/en\/coins\/solana"/,
    );
    // The raw `## ` and `[]()` syntax should NOT appear as literal text
    // in the rendered output.
    expect(html).not.toContain("## SOL price");
    expect(html).not.toContain("[coingecko.com]");
  });

  it("renders JSON-shaped content as a plain monospace block (NOT markdown)", () => {
    // The existing params/result decoded JSON shape — `{...}` first
    // char rules out markdown rendering even though it has `:` and
    // similar punctuation a markdown parser might choke on.
    const jsonResult = { rate: 2380.42, ethOut: 0.42 };
    const html = renderToStaticMarkup(
      createElement(EntryCard, makeEntryProps({ result: jsonResult })),
    );
    // Should appear inside a `<pre>` (the plain path), NOT inside a
    // `<div class="markdown-body">`. React escapes quote characters
    // to `&quot;` in static markup — match on `rate` + `2380.42` (the
    // values) which are quote-agnostic.
    expect(html).toMatch(/<pre[^>]*>[\s\S]*?rate[\s\S]*?2380\.42[\s\S]*?<\/pre>/);
    expect(html).not.toMatch(/<div class="markdown-body[^"]*">[\s\S]*?rate/);
  });

  it("plain string without markdown signals also stays in the monospace pre block", () => {
    // A bare text response (no headers, no bullets, no links) is too
    // ambiguous to commit to markdown — falls through to the safe
    // monospace path.
    const html = renderToStaticMarkup(
      createElement(
        EntryCard,
        makeEntryProps({ result: "Operation completed successfully." }),
      ),
    );
    expect(html).toMatch(/<pre[^>]*>Operation completed successfully\.<\/pre>/);
  });

  it("plain path uses whitespace-pre-wrap + break-words (no horizontal scroll)", () => {
    // Abu's 2026-05-15 critique: "i had to scroll horizonally to the
    // left which dosent make sense". The fix flipped `overflow-x-auto`
    // to wrap-inside-card. Long URLs in a JSON dump exercise this.
    const longUrlContent = {
      url: "https://example.com/" + "a".repeat(500),
    };
    const html = renderToStaticMarkup(
      createElement(EntryCard, makeEntryProps({ result: longUrlContent })),
    );
    // The `<pre>` element must carry both classes for wrap-inside.
    expect(html).toMatch(/<pre[^>]*whitespace-pre-wrap[^>]*break-words/);
    // And must NOT carry the legacy overflow-x-auto on the plain path.
    // (We only check the FIRST pre in the markup so a nested
    // markdown-body pre wouldn't false-positive — but we're in the
    // plain path here so there shouldn't be a markdown body anyway.)
    const firstPreMatch = html.match(/<pre [^>]+>/);
    expect(firstPreMatch).not.toBeNull();
    expect(firstPreMatch![0]).not.toContain("overflow-x-auto");
  });
});
