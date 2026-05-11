import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import "./globals.css";

// `geist` npm package (Vercel-published) ships the same Geist Sans /
// Mono families that `next/font/google` exposes in Next.js 15+. Used
// here because we're on Next.js 14.2 — switching to next/font/google
// directly is a one-line change when we upgrade.

export const metadata: Metadata = {
  title: "Verifiable Agent Execution",
  description:
    "Etherscan for AI agents — share a URL, verify any agent run cold. Anchored on 0G AgenticID.",
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
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
