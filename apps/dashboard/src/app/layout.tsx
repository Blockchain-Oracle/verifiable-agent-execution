import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { MainnetAnnouncementTicker } from "@/components/MainnetAnnouncementTicker";
import { loadEnv, networkBadge } from "@/lib/env";

import "./globals.css";

// `geist` npm package (Vercel-published) ships the same Geist Sans /
// Mono families that `next/font/google` exposes in Next.js 15+. Used
// here because we're on Next.js 14.2 — switching to next/font/google
// directly is a one-line change when we upgrade.

export const metadata: Metadata = {
  title: "AGENTSCAN — Etherscan for AI agents",
  description:
    "AGENTSCAN: cryptographically signed, on-chain-anchored receipts for every AI agent run. Share a URL, verify any session cold. Anchored on 0G AgenticID.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "48x48" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `dark` class is set explicitly because the UX spec is dark-only —
  // we don't need a theme provider. The CSS variables for Geist Sans /
  // Mono are bound on <html> so Tailwind's `font-sans` / `font-mono`
  // resolve to them.
  //
  // The MainnetAnnouncementTicker mounts here (above any per-page
  // <TopBar />) so judges and first-time visitors see the
  // mainnet cross-link from EVERY page. It self-suppresses on the
  // mainnet deploy (we don't tell users to "view mainnet" on
  // mainnet.agentscan.online itself) and on dismiss.
  const env = loadEnv();
  const badge = networkBadge(env);
  const isMainnet = badge.label === "MAINNET";
  // `oppositeUrl` is the sibling deploy URL — for testnet, that's
  // mainnet. Fall back to the canonical mainnet domain if env didn't
  // configure one (e.g. local dev with no env overrides).
  const mainnetHref =
    !isMainnet && typeof badge.oppositeUrl === "string" && badge.oppositeUrl.length > 0
      ? badge.oppositeUrl
      : "https://mainnet.agentscan.online";
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <MainnetAnnouncementTicker isMainnet={isMainnet} mainnetHref={mainnetHref} />
        {children}
      </body>
    </html>
  );
}
