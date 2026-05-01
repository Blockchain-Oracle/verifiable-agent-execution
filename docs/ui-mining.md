# UI Mining Briefing — Verifiable Agent Execution Dashboard
**Project:** 0G APAC Hackathon 2026 — Verifiable Agent Execution
**Date:** 2026-05-01
**Skill:** sahil-ui-mining v2

---

## TL;DR (Top 2 Picks Ranked)

1. **Trigger.dev** (`trigger.dev`) — PRIMARY. Best match: execution logs, run timelines, task-level status, dark charcoal palette. Open source (Apache-2.0), cloneable, real product taste. Its run detail view is almost exactly the layout we need (task input → TEE proof → verification status).
2. **Hyperlane Explorer** (`explorer.hyperlane.xyz`) — SECONDARY. Cross-chain message verification = closest functional analog to on-chain attestation lookup. Open source (Apache-2.0), Next.js + Tailwind. Visual design is developer-grade but lighter color scheme; use for information architecture, not color palette.

---

## Project Spec Recap

**What it is:** Infrastructure primitive proving an AI agent ran exactly what it claimed.
- Agent executes task → TEE-sealed proof (0G Private Computer) → stored on 0G Storage → iNFT attestation minted (ERC-7857) → verifiable proof link

**UI surface:** Proof verification dashboard
- Agent runs list (task input + model used)
- TEE execution proof (signature + signing address)
- On-chain iNFT attestation (contract address + token ID + explorer link)
- Verification status (verified / failed)
- "Verify this proof" CTA that checks signature on-chain
- Recent runs list

**Vibe:** Audit trail / observability. "Proof of work log" meets "blockchain explorer." Clean, technical, developer-grade. No marketing.

---

## Candidate Research Cards

---

### 1. Trigger.dev

**Live URL:** https://trigger.dev
**Repo URL:** https://github.com/triggerdotdev/trigger.dev
**License:** Apache-2.0 — HACKATHON SAFE (clone allowed)
**Stars:** ~14,749
**Last commit:** 2026-05-01 (active daily)
**Stack:** Next.js (App Router) + React, TypeScript, pnpm monorepo (Turborepo)
**CSS:** Tailwind CSS v3 custom config — proprietary semantic token system (NOT shadcn defaults)
**Animation:** [UNVERIFIED] — likely Framer Motion for page transitions, CSS transitions for micro-interactions
**Copy tone:** Terse, technical, Linear-tier

**Design tokens (verified from `apps/webapp/tailwind.config.js`):**
- Background (main): `#15171A` (charcoal-850)
- Surface (cards/panels): `#1A1B1F` (charcoal-800)
- Border (grid lines): `#272A2E` (charcoal-700)
- Border (subtle): `#212327` (charcoal-750)
- Text primary: `#D7D9DD` (charcoal-200)
- Text secondary: `#878C99` (charcoal-400)
- Accent green (success/run success): `#A8FF53` (apple-500)
- Accent lavender (primary CTA): `#9A0DFF` — [confirmed purple-primary palette]
- Error: rose-600 (`#E11D48`)
- Warning: amber-500 (`#F59E0B`)
- Secondary bg: `#2C3034` (charcoal-650)

**Typography:**
- Font: `non.geist` (Geist Sans + Geist Mono by Vercel) — free, self-hosted via npm
- Body: Geist Sans regular/medium
- Mono (code/addresses/IDs): Geist Mono regular
- **No custom foundry fonts — all open/free**

**Motion patterns:**
- Execution timeline with live streaming log lines (animated entry)
- Status badge transitions (pending → running → success/failed)
- Sidebar nav hover: subtle bg shift, 150ms ease
- Run list rows: hover bg lift on charcoal-750

**Empty/loading state polish:** YES — skeleton screens for run list, spinner for live run

**Lift verdict: CLONE**
- Apache-2.0 license permits hackathon use
- Repo structure: `apps/webapp` is the main dashboard — directly usable
- The run detail page maps near 1:1 to our proof detail view

**Why it fits:**
The Trigger.dev run detail page is structurally identical to what we need: task input at top, execution steps with timestamps below, status indicators per step, a final status badge. Our proof dashboard maps as: task input → TEE execution step → 0G storage step → iNFT mint step → verification result. The charcoal dark palette is zero-marketing, developer-first, and does not read as "crypto dashboard."

---

### 2. Hyperlane Explorer

**Live URL:** https://explorer.hyperlane.xyz
**Repo URL:** https://github.com/hyperlane-xyz/hyperlane-explorer
**License:** Apache-2.0 — HACKATHON SAFE
**Stars:** ~101
**Last commit:** 2026-04-30 (active)
**Stack:** Next.js + React, TypeScript, pnpm
**CSS:** Tailwind CSS v3 (`tailwind.config.js` confirmed)
**Animation:** [UNVERIFIED]
**Copy tone:** Terse, technical, developer-focused

**Design tokens (verified from `tailwind.config.js` and `src/styles/global.css`):**
- Body background: `#f8f8ff` (light off-white, NOT dark mode first)
- Custom black: `#3d304c` (warm dark purple — typography)
- Custom white: `#f8f8ff`
- Fonts: PP Fraktion Mono + PP Valve (PROPRIETARY — PP Type Foundry, NOT free)
- Palette: Purple primary (`#9A0DFF` range), lavender accent, beige surface
- Border radius: extremely tight (1–4px scale)

**Typography:**
- Primary: PP Valve Variable (proprietary) — NOT freely licensable
- Mono: PP Fraktion Mono Variable (proprietary)
- **CRITICAL:** These fonts cannot be used in a hackathon without a license. Must substitute with Geist Mono (free) or JetBrains Mono.

**Motion patterns:**
- Tight border-radius transitions
- Explorer-style message status flow (dispatched → validated → delivered)
- Message detail drilldown: hash, addresses, status, chain logos

**Empty/loading state polish:** Middling — basic loading states

**Lift verdict: PARTIAL**
- License permits cloning (Apache-2.0), but fonts are proprietary
- The information architecture is gold: message detail pages with tx hash, addresses, origin→destination status chain maps directly to our proof detail (run ID, signing address, contract address, attestation status)
- Clone the layout/IA, substitute palette and fonts

**Why it fits:**
The closest functional analog to our use case: shows a single verifiable on-chain message with all its metadata — origin tx, destination tx, sender/recipient addresses, verification status. Our iNFT attestation view = their message detail view. Use as IA reference only; do not lift the CSS/fonts.

---

### 3. OpenStatus

**Live URL:** https://www.openstatus.dev
**Repo URL:** https://github.com/openstatusHQ/openstatus
**License:** AGPL-3.0 — RESTRICTED for hackathons (copyleft, cannot use in closed-source submission)
**Stars:** ~8,626
**Last commit:** 2026-05-01 (very active)
**Stack:** Next.js (App Router) + React, TypeScript, pnpm/Turborepo
**CSS:** Tailwind CSS v4 + shadcn/ui (zinc/neutral base)

**Design tokens (verified from `packages/ui/src/globals.css`):**
- Dark mode background: oklch(0.145 0 0) ≈ `#0C0C0C`
- Dark mode surface/card: oklch(0.205 0 0) ≈ `#1C1C1C`
- Dark mode border: oklch(0.922 0 0) in light / oklch(0.269 0 0) in dark ≈ `#2A2A2A`
- Text primary: oklch(0.985 0 0) ≈ `#FAFAFA`
- Text secondary: oklch(0.708 0 0) ≈ `#A1A1AA`
- Success: oklch(0.72 0.19 150) ≈ green
- Fonts: Geist Sans + Geist Mono + Cal Sans (display only) + Commit Mono

**Motion patterns:**
- shadcn/ui default transitions
- Status indicator dot animations for live monitors
- Response time chart animations

**Empty/loading state polish:** YES — good skeleton states per their template repo

**Lift verdict: NO — license blocks it**
- AGPL-3.0 requires all derivative works (including hackathon submissions) to be open source and carry the same license
- Visual is a solid shadcn zinc dark — but it's the "familiar shadcn" look, not the most distinctive
- Rejected on license; strong vibe reference only

**Why it fits (partially):**
Status page concept + uptime monitoring maps loosely to our proof verification audit trail. But the AGPL blocks cloning, and the visual is less distinctive than Trigger.dev for our specific use case.

---

### 4. BetterStack

**Live URL:** https://betterstack.com
**Repo URL:** Closed source (no public frontend repo found)
**License:** Proprietary — CANNOT CLONE
**Stack:** [UNVERIFIED] — likely Next.js/React based on homepage behavior
**CSS:** [UNVERIFIED]

**Design tokens (from homepage inspection and brand materials):**
- Background: Deep off-black (appears `#0D0D10` range)
- Surface: Dark gray cards
- Text: White/near-white primary, gray secondary
- Accent: Vibrant green (uptime health) + orange/red (incidents)
- Border: Subtle dark gray

**Motion patterns:**
- Log stream live-tail animation (signature feature)
- Incident timeline cascading entries
- Smooth status badge transitions

**Lift verdict: REPLICATE**
- Cannot clone (closed source)
- Visual language is excellent for our use case: log tailing, incident timeline, verification status

**Why it fits:**
The log stream and incident timeline are reference-grade for our TEE proof execution log. The "Live tail" view = our execution log in real-time. Use as visual reference for the log/stream component.

---

### 5. Dune Analytics

**Live URL:** https://dune.com
**Repo URL:** Closed source
**License:** Proprietary — CANNOT CLONE
**Stack:** [UNVERIFIED]
**CSS:** [UNVERIFIED]

**Design tokens (from official brand page `dune.com/brand`):**
- Background: `#0F0F15` (Off-Black)
- Accent 1: `#F4603E` (Dune Orange)
- Accent 2: `#F9DC5C` (Dune Yellow)
- Text: `#FFFFFF`
- Secondary brand: Sim Blue `#446BCE`, Sim Green `#109C6B`

**Typography:**
- Primary font: [UNVERIFIED from brand page — font name not explicitly listed but appears custom sans]

**Lift verdict: REPLICATE (limited)**
- Closed source
- Data-heavy, query-focused dashboard — different mental model from our verification dashboard
- The on-chain data exploration ethos is directionally relevant but layout is too complex for our focused use case

**Why it partially fits:**
Technical blockchain audience, developer-focused data display. The color palette signal (very dark background + warm orange accent) is interesting but diverges from the observability/audit-trail feel we want.

---

## Chosen Anchors

### Primary: Trigger.dev
**Rationale:**
1. **Function match:** The run detail page is the structural closest thing to a "proof detail" view. Steps, timestamps, status per step, final outcome — this is our exact layout.
2. **Palette fit:** Dark charcoal (`#15171A` bg) reads as professional infrastructure tooling, not "Web3 dark mode." It avoids the neon/gradient crypto UI aesthetic that would undermine trust with developer judges.
3. **License:** Apache-2.0 — clean hackathon use.
4. **Open repo:** `apps/webapp` can be read end-to-end. Components are real production-grade, not scaffolding.
5. **Fonts:** Geist (free, self-hosted) — zero licensing risk.
6. **Taste tier:** Abu-confirmed anchor product in the SKILL.md. This is the calibrated default for workflow/execution dashboards.

**Confidence:** HIGH

### Secondary: Hyperlane Explorer
**Rationale:**
1. **IA match:** Message detail page (tx hash, addresses, status chain) = our proof detail page (run ID, signing address, contract + token ID, attestation status). Best IA reference available.
2. **Blockchain-native:** Built for developers verifying cross-chain messages — same cognitive mode as developers verifying TEE execution proofs.
3. **License:** Apache-2.0.
4. **Caveat:** Fonts are proprietary (PP Type Foundry) — must substitute. Palette is primarily light mode — use the dark adaptation approach, not the light palette.

**Use:** Lift the information architecture (page structure, metadata field layout, status indicator chain) but use Trigger.dev's color palette.

---

## Clone-and-Adapt Handoff (Coding Agent)

### Primary repo to read for structure
```
Repo: https://github.com/triggerdotdev/trigger.dev
Branch: main
Target path: apps/webapp/app/
```

**Key files to study (read, not run):**
- `apps/webapp/tailwind.config.js` — full token system
- `apps/webapp/app/tailwind.css` — base styles + layer utilities
- Look for run detail page under `apps/webapp/app/routes/` or similar — this is the layout to replicate

**Secondary repo for IA reference:**
```
Repo: https://github.com/hyperlane-xyz/hyperlane-explorer
Branch: main
Target: src/features/messages/ (message detail view IA)
```

### Palette swap
Replace any Trigger.dev product-specific colors (lavender/acid/toxic palettes) with our project palette as defined in DESIGN.md.

Keep: charcoal scale, Geist font, border/grid system
Replace: purple accent → our verification accent (see DESIGN.md)

### Font swap
Trigger.dev uses: `non.geist` (Geist Sans + Mono)
Our build: Keep identical — Geist Sans (body) + Geist Mono (addresses/hashes/IDs)
Install: `npm install geist` from Vercel

### Components to keep from Trigger.dev IA:
- Sidebar nav pattern (collapsible, section-grouped)
- Run list table (status badge + timestamp + duration cols)
- Run detail header (ID, status badge, trigger info)
- Step/task timeline (vertical list with status per step)
- Log output panel (mono font, dark bg, line-numbered)
- Status badge variants (pending, running, completed, failed)

### Components to replace/adapt:
- "Trigger" branding → "Proof Verifier" branding
- Job/task taxonomy → Proof/Run taxonomy
- Dev/Prod environment toggle → not needed
- Pricing/billing links → remove

### Components to add (from Hyperlane IA):
- Attestation card: contract address + token ID + explorer deeplink
- Signing address with copy-to-clipboard + blockexplorer link
- Verification status chain (TEE sealed → stored → minted → verified)
- "Verify this proof" CTA button (connects wallet or calls RPC)

### Out of scope for this build:
- Dark/light mode toggle (dark-only is fine for judges)
- Real-time log streaming (static proof display first)
- Multi-run comparison view

### Copy direction:
- All UI copy: terse, technical, no exclamation marks
- Labels: "Run ID", "Model", "Signing Address", "TEE Proof", "Attestation", "Token ID", "Verified At"
- Status: "Verified" (not "Success!"), "Failed" (not "Error occurred")
- CTA: "Verify Proof" (not "Check It Now!")

---

## Sources

- OpenStatus repo: https://github.com/openstatusHQ/openstatus (AGPL-3.0, 8.6k stars)
- Trigger.dev repo: https://github.com/triggerdotdev/trigger.dev (Apache-2.0, 14.7k stars)
- Hyperlane Explorer repo: https://github.com/hyperlane-xyz/hyperlane-explorer (Apache-2.0, 101 stars)
- Dune brand page: https://www.dune.com/brand
- BetterStack homepage: https://betterstack.com
- Trigger.dev tailwind.config.js: verified via GitHub raw API
- Hyperlane tailwind.config.js: verified via GitHub raw API
- OpenStatus packages/ui/src/globals.css: verified via GitHub raw API
