// mainnet-ticker.test.tsx — pins Tier 1.6 behavior (Abu 2026-05-15
// directive: "on top will be some scrolling stuff... live on mainnet").
//
//   1. Renders on the TESTNET deploy (isMainnet=false) so judges see
//      the cross-link to mainnet from every testnet page.
//   2. Does NOT render on the MAINNET deploy (no "view mainnet" on
//      mainnet itself).
//   3. Renders as a static centered strip — NOT a scrolling marquee
//      (Abu 2026-05-15: "why did you do it as a life ticker? It
//      should be in one place"). Earlier impl used the `ticker 24s
//      linear infinite` keyframe; we now assert the LIVE-pulse dot
//      class is present and the marquee class is NOT.
//   4. Open-link points to mainnetHref.
//   5. Has a dismiss button.
//
// Rendered via react-dom/server's renderToStaticMarkup. The dismissed
// state lives in localStorage which renderToStaticMarkup can't drive,
// so we cover the dismiss interaction via the assertion-on-presence
// path only (the localStorage round-trip is exercised at runtime).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MainnetAnnouncementTicker } from "@/components/MainnetAnnouncementTicker";

describe("MainnetAnnouncementTicker — Tier 1.6", () => {
  it("renders on testnet (isMainnet=false) with the LIVE ON MAINNET label", () => {
    const html = renderToStaticMarkup(
      createElement(MainnetAnnouncementTicker, {
        isMainnet: false,
        mainnetHref: "https://mainnet.agentscan.online",
      }),
    );
    expect(html).toContain("LIVE ON MAINNET");
    // The cross-link to the mainnet site.
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/mainnet\.agentscan\.online"/,
    );
  });

  it("does NOT render on mainnet (the strip would be silly there)", () => {
    const html = renderToStaticMarkup(
      createElement(MainnetAnnouncementTicker, {
        isMainnet: true,
        mainnetHref: "https://mainnet.agentscan.online",
      }),
    );
    expect(html).toBe("");
  });

  it("renders as a static centered strip — no scrolling marquee keyframe", () => {
    const html = renderToStaticMarkup(
      createElement(MainnetAnnouncementTicker, {
        isMainnet: false,
        mainnetHref: "https://mainnet.agentscan.online",
      }),
    );
    // Live-pulse dot uses Tailwind's `animate-ping` — that's the ONLY
    // animation; no full-strip translate keyframe.
    expect(html).toMatch(/animate-ping/);
    expect(html).not.toMatch(/animate-\[ticker/);
    // Centered layout class present.
    expect(html).toMatch(/justify-center/);
  });

  it("includes a dismiss button (× pinned right) for judge ergonomics", () => {
    const html = renderToStaticMarkup(
      createElement(MainnetAnnouncementTicker, {
        isMainnet: false,
        mainnetHref: "https://mainnet.agentscan.online",
      }),
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Dismiss mainnet announcement"/,
    );
  });
});
