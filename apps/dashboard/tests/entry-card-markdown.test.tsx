// entry-card-markdown.test.tsx — pins Tier 1.5 (Abu 2026-05-15):
//
//   1. Tool-result content that LOOKS like markdown (WebSearch results
//      with [text](URL) citations, lists, bold) gets rendered as HTML
//      with anchor tags + lists + bold, not as a wall of `*` characters.
//   2. JSON-like content keeps rendering as a highlighted code block —
//      react-markdown would mangle it.
//   3. Long values (URLs, sessionKeys, paths) wrap inside the card
//      instead of triggering horizontal scroll. react-syntax-highlighter
//      applies white-space:pre-wrap + word-break:break-all via its
//      theme inline styles (not Tailwind classes).
//   4. Plain strings without markdown signals stay in a monospace block.
//
// Renders ContentBlock directly (exported from EntryCard) with open={true}
// so we test the content-rendering logic independently of the collapse
// toggle. This avoids the jsdom + user-event dependency that the old
// EntryCard-level tests would have needed after we switched to
// collapsed-by-default in v0.3.x.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContentBlock } from "@/components/EntryCard";

const noop = () => {};

function renderBlock(value: unknown) {
  return renderToStaticMarkup(
    createElement(ContentBlock, {
      label: "Result",
      value,
      fallbackHash: "a".repeat(64),
      open: true,
      onToggle: noop,
    }),
  );
}

describe("ContentBlock — rendering (v0.3.7 Tier 1.5)", () => {
  it("renders a markdown string as HTML when it has structural signals", () => {
    const markdownResult =
      "## SOL price\n\n- Current: $93.42\n- 24h: +1.8%\n\nSource: [coingecko.com](https://www.coingecko.com/en/coins/solana)";
    const html = renderBlock(markdownResult);
    // The h2 + bullets + anchor tag should be in the output.
    expect(html).toMatch(/<h2[^>]*>SOL price<\/h2>/);
    expect(html).toMatch(/<ul[^>]*>/);
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www\.coingecko\.com\/en\/coins\/solana"/,
    );
    // The raw `## ` and `[]()` syntax should NOT appear as literal text.
    expect(html).not.toContain("## SOL price");
    expect(html).not.toContain("[coingecko.com]");
  });

  it("renders JSON-shaped content as a syntax-highlighted code block (NOT markdown)", () => {
    const jsonResult = { rate: 2380.42, ethOut: 0.42 };
    const html = renderBlock(jsonResult);
    // react-syntax-highlighter wraps in <pre><code>...</code></pre>.
    // The values appear inside span tokens — [\s\S]*? crosses them.
    expect(html).toMatch(/<pre[^>]*>[\s\S]*?rate[\s\S]*?2380\.42[\s\S]*?<\/pre>/);
    // Must NOT be in a markdown-body div.
    expect(html).not.toMatch(/<div class="markdown-body[^"]*">[\s\S]*?rate/);
  });

  it("plain string without markdown signals stays in the monospace block", () => {
    const html = renderBlock("Operation completed successfully.");
    // SyntaxHighlighter renders <pre ...><code ...>text</code></pre>
    expect(html).toMatch(/<pre[^>]*>[\s\S]*?Operation completed successfully\.[\s\S]*?<\/pre>/);
  });

  it("plain path uses pre-wrap + break-all (no horizontal scroll)", () => {
    const longUrlContent = {
      url: "https://example.com/" + "a".repeat(500),
    };
    const html = renderBlock(longUrlContent);
    // react-syntax-highlighter applies the agentscanTheme inline styles:
    //   white-space: pre-wrap  (wraps long lines)
    //   word-break: break-all  (breaks within words so nothing overflows)
    // These are inline style props, not Tailwind class names.
    expect(html).toMatch(/white-space:\s*pre-wrap/);
    expect(html).toMatch(/word-break:\s*break-all/);
    // Overflow must not be auto on the pre (we use hidden to match the
    // wrap-inside-card intent; overflowX:"hidden" is set in agentscanTheme).
    // A simple sanity check: the pre element's style should not say auto.
    const preMatch = html.match(/<pre [^>]+>/);
    expect(preMatch).not.toBeNull();
    expect(preMatch![0]).not.toContain("overflow-x: auto");
  });
});
