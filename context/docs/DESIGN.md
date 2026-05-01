# DESIGN.md — Verifiable Agent Execution Dashboard
**Project:** 0G APAC Hackathon 2026
**Date:** 2026-05-01
**Status:** GATE PASSED — coding agent handoff authorized

---

## Anchor

- **Primary:** Trigger.dev (https://trigger.dev) — execution log / run detail view maps 1:1 to our proof detail view; charcoal dark palette; Apache-2.0; Geist fonts (free)
- **Secondary:** Hyperlane Explorer (https://explorer.hyperlane.xyz) — information architecture for on-chain message/attestation detail pages; Apache-2.0

---

## Palette

All values verified from Trigger.dev `apps/webapp/tailwind.config.js` (charcoal scale) with project-specific accent substitution.

- **Background:** `#15171A` — main page background (charcoal-850)
- **Surface:** `#1A1B1F` — card / panel background (charcoal-800)
- **Surface elevated:** `#2C3034` — hover state / elevated card (charcoal-650)
- **Border:** `#272A2E` — default border / grid line (charcoal-700)
- **Border subtle:** `#212327` — secondary dividers (charcoal-750)
- **Text primary:** `#D7D9DD` — headings and important labels (charcoal-200)
- **Text secondary:** `#878C99` — metadata, timestamps, secondary labels (charcoal-400)
- **Text disabled:** `#5F6570` — disabled states (charcoal-500)
- **Accent:** `#3B82F6` — used ONLY for primary CTA ("Verify Proof" button) and active navigation item; blue chosen over purple to avoid crypto/Web3 aesthetic cliché
- **Verified (success):** `#22C55E` — verification success badge, verified status indicator
- **Failed (destructive):** `#E11D48` — failed verification badge, error state
- **Pending:** `#F59E0B` — pending/in-progress state (amber)
- **Mono surface:** `#0D0E12` — background for code/address/log blocks (charcoal-950)

---

## Typography

- **Display:** Geist Sans, weights 600/700 — used ONLY for page title and run ID header (H1/H2)
- **Body:** Geist Sans, weights 400/500 — used for all body copy, labels, descriptions
- **Mono:** Geist Mono, weight 400 — used for ALL addresses (0x…), hashes, token IDs, contract addresses, log output, signatures
- **Install:** `npm install geist` (Vercel, free, self-hosted)

**Scale (px):**
- 12px — timestamp labels, chip text, metadata footnotes
- 14px — table cell text, secondary labels, sidebar nav
- 16px — body paragraphs, primary labels
- 18px — section subheadings (H3/H4)
- 24px — page section headings (H2)
- 32px — run ID / proof title (H1 display)

---

## Spacing

- **Base unit:** 4px
- **Scale in use:** 4, 8, 12, 16, 24, 32, 48, 64
- **Card padding:** 24px (p-6)
- **Section gap:** 32px (gap-8)
- **Inline element gap:** 8–12px
- **Sidebar width:** 240px (fixed)

---

## Border Radius

- **Default (cards, panels):** 6px (`rounded-md` equivalent)
- **Badges/chips:** 4px (`rounded`)
- **Buttons:** 6px (`rounded-md`)
- **Code blocks:** 4px
- **NO** `rounded-xl` or `rounded-2xl` — too soft for a developer tool

---

## Motion

- **Hover (table rows):** `background-color` transition to surface-elevated (`#2C3034`), 150ms ease-out; NO translate/shadow lift
- **Hover (buttons):** `background-color` darken by ~8%, 100ms ease
- **Status badge:** fade-in on initial render, 200ms ease
- **Verification flow steps:** staggered opacity + translateY(4px→0) entry, 100ms per step, 50ms stagger delay
- **Page transition:** none (SPA navigation only)
- **Loading (table/list):** skeleton shimmer — charcoal-800 base + charcoal-700 highlight, 1.5s ease-in-out loop
- **Loading (proof detail):** skeleton rows with pulse animation
- **Live log lines:** slide-in from bottom-left, opacity 0→1, 80ms ease — only used if streaming is implemented

---

## Component Interaction States

All components must implement these states before handoff is complete:

### Table Rows (Recent Runs)
- **Default:** bg `#15171A`, text `#D7D9DD`
- **Hover:** bg `#2C3034`, 150ms ease
- **Active/selected:** bg `#2C3034` + left border 2px `#3B82F6`
- **Empty:** "No runs yet" centered in table body, text secondary
- **Loading:** 5 skeleton rows, shimmer animation

### Verify Proof Button
- **Default:** bg `#3B82F6`, text white, weight 500
- **Hover:** bg `#2563EB` (blue-600), 100ms ease
- **Active/pressed:** bg `#1D4ED8` (blue-700)
- **Disabled:** bg `#272A2E`, text `#5F6570`, cursor-not-allowed
- **Loading (verifying):** spinner left of "Verifying…" label, bg `#2563EB`

### Status Badges (Verified / Failed / Pending)
- **Verified:** bg `#166534` (green-900 dark), text `#22C55E`, border `#166534`
- **Failed:** bg `#881337` (rose-900 dark), text `#E11D48`, border `#881337`
- **Pending:** bg `#78350F` (amber-900 dark), text `#F59E0B`, border `#78350F`
- Focus ring: 2px offset, `#3B82F6`

### Address / Hash Fields (Copy-to-clipboard)
- **Default:** Geist Mono, `#878C99`, bg `#0D0E12`, px-3 py-1
- **Hover:** copy icon visible (opacity 0→1, 150ms)
- **Active/clicked:** "Copied!" tooltip, 1s then fade out
- **Focus:** outline 2px `#3B82F6`

### Verification Step Chain
- **Default (not yet run):** circle outline `#272A2E`, text `#5F6570`
- **In progress:** circle pulse animation, `#F59E0B`
- **Completed:** filled circle `#22C55E` + checkmark
- **Failed:** filled circle `#E11D48` + x mark
- **Connector line:** `#272A2E` (inactive) / `#22C55E` (completed)

---

## Banned (Do Not Use)

**Gradients:**
- `from-purple-500 to-pink-500`
- `from-violet-600 to-indigo-600`
- `from-blue-500 to-cyan-500`
- Any rainbow/multi-stop gradient on UI chrome (charts only)
- `bg-gradient-to-r` on cards or section backgrounds

**Cards:**
- `rounded-xl shadow-md` without explicit border-color — always pair with `border border-[#272A2E]`
- Three identical cards with same radius/shadow/padding and no visual differentiation
- `shadow-lg` — too heavy for flat dark theme; use border instead of shadow for elevation

**Typography:**
- `font-sans` without the Geist import
- `text-gray-600` on any background — use charcoal tokens
- `font-black` (weight 900) — too heavy

**Copy (mock-data tells):**
- "John Doe", "Jane Smith", "user@example.com"
- "Lorem ipsum"
- `0x0000...` as a placeholder address — use realistic-looking truncated hashes
- `ui-avatars.com`, `randomuser.me`, `picsum.photos`
- "$1,234.56" or any dollar amounts

**Structure:**
- Centered text-only hero on a gradient background
- Empty section dividers with no content
- Marketing copy ("Revolutionary", "Trustless", "Blazing fast")
- Progress bars as primary status indicator — use badge + step chain instead

**Colors NOT in palette:**
- `#9A0DFF` (Hyperlane/Web3 purple) — not in our palette, avoid crypto-purple cliché
- `#F4603E` (Dune orange) — not our accent
- Any neon: `#00FF00`, `#FF00FF`, `#00FFFF`
- Pure black `#000000` as background — use `#15171A`
- Pure white `#FFFFFF` as text — use `#D7D9DD`

**Fonts NOT to use:**
- PP Fraktion Mono or PP Valve — proprietary (Hyperlane uses these; we cannot)
- Uncustomized Inter — too generic; must use Geist
- `font-sans` defaulting to system-ui without explicit Geist declaration

---

## Page Structure (Proof Verification Dashboard)

### Layout
```
┌─────────────────────────────────────────────┐
│ Sidebar (240px)     │ Main content area       │
│ - Logo              │ - Page header           │
│ - Recent runs nav   │ - Content (varies)      │
│ - Settings          │                         │
└─────────────────────────────────────────────┘
```

### Pages
1. **Runs list** — table of recent agent runs, status badges, timestamps
2. **Proof detail** — single run expanded: task input, TEE proof, on-chain attestation, verification status + CTA
3. **Verify by ID** — search/lookup by run ID or tx hash

### Proof Detail Page Layout
```
[Run ID + Status Badge]               [Verify Proof button]

┌─────────── Task Execution ──────────┐
│ Input: [task description mono]      │
│ Model: [model name]                 │
│ Started: [timestamp]                │
└─────────────────────────────────────┘

[Verification Step Chain]
  ① TEE Sealed  ② 0G Stored  ③ iNFT Minted  ④ Verified

┌─────────── TEE Proof ───────────────┐
│ Signing Address: [0x... mono + copy]│
│ Signature: [0x... truncated + copy] │
└─────────────────────────────────────┘

┌─────────── On-Chain Attestation ────┐
│ Contract: [0x... + explorer link]   │
│ Token ID: [#1234]                   │
│ Chain: [chain name]                 │
└─────────────────────────────────────┘
```
