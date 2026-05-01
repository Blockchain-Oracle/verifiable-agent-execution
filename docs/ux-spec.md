# UX Spec — Verifiable Agent Execution
**Project:** Verifiable Agent Execution  
**Updated:** 2026-05-01  
**Anchors:** Trigger.dev (primary), Hyperlane Explorer (IA reference)

---

## Anchor product

**Primary:** Trigger.dev (https://trigger.dev)
- Why chosen: Apache-2.0 licensed, production-grade dark dashboard, charcoal palette with precise color tokens, Geist typography, clean run-detail page that maps directly to our proof-chain detail view.
- Demo focus: Run detail view (shows sequence of events with timestamps, inputs/outputs, status badges) — we clone this structure for log-entry detail.
- Secondary reference: Hyperlane Explorer (https://explorer.hyperlane.xyz) for proof-detail information architecture (message detail page → our attestation detail page).

---

## Design tokens

### Palette

All hex values verified from source repos:

| Token | Hex | Usage |
|---|---|---|
| **Background (primary)** | `#15171A` | Page background, body |
| **Surface (card)** | `#1A1B1F` | Card backgrounds, elevation +1 |
| **Surface (elevated)** | `#22252D` | Modals, dialogs, elevation +2 |
| **Border** | `#363A45` | Card borders, dividers, input borders |
| **Text primary** | `#F5F5F5` | Body copy, headings |
| **Text secondary** | `#A3A6B1` | Captions, metadata, muted text |
| **Accent (verify)** | `#10B981` | "Verified" badge, success states, CTA |
| **Accent (mock)** | `#F59E0B` | "Mock" badge, warning states |
| **Accent (unverified)** | `#EF4444` | "Unverified" / error states |
| **Link** | `#3B82F6` | Links, "View on Explorer" |

**Dark mode only** — no light mode in hackathon scope.

### Typography

| Category | Font | Weights | Usage |
|---|---|---|---|
| **Display** | Geist Sans | 700 (bold) | Page titles (H1) |
| **Heading** | Geist Sans | 600 (semibold) | Section headings (H2, H3) |
| **Body** | Geist Sans | 400 (regular), 500 (medium) | All body copy, card text |
| **Mono** | Geist Mono | 400, 500 | Code blocks, hashes, contract addresses |

**Font imports:**
```css
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap');
@import url('https://rsms.me/inter/inter-ui.css'); /* Fallback: Inter */
```

**Scale (px):**
- Body (p): 14px / 16px (Trigger.dev's detail page standard)
- Small text (caption): 12px
- Headings: H1 = 32px, H2 = 24px, H3 = 20px

### Spacing

**Base unit:** 4px

**Scale in use:**
- xs: 4px
- sm: 8px
- md: 12px
- lg: 16px
- xl: 24px
- 2xl: 32px
- 3xl: 48px

### Motion

| State | Animation | Duration | Easing |
|---|---|---|---|
| **Hover (button)** | `translate-y-[-2px]` + shadow lift | 150ms | `ease-out` |
| **Hover (card)** | Subtle border color shift `#363A45` → `#50586A` | 150ms | `ease-out` |
| **Page transition** | Fade in/out | 200ms | `ease-in-out` |
| **Loading spinner** | Rotate 360° (linear) | 1s | `linear` |
| **Skeleton shimmer** | Pulse opacity 0.5 → 1 → 0.5 | 2s | `ease-in-out` |

---

## Route shape

### Pages in scope

| Route | Purpose | Layout |
|---|---|---|
| `/` | Landing: explain the primitive, link to verify | Hero + feature cards |
| `/verify/[tokenId]` | Proof chain view — main demo surface | Detail page with proof chain |
| `/api/verify/[tokenId]` | REST endpoint — resolve chain → storage → log | API (not a page) |

### Navigation

- No persistent header nav (judge demos don't need it)
- Landing page has a single CTA: "Verify a Proof" → input tokenId → `/verify/[tokenId]`
- Proof chain page has: "Home" link (top-left), "View on Explorer" link (card footer)

---

## Demo shape rule

**What gets demoed (5-step judge walkthrough):**

1. **Terminal** — Run OpenClaw session, see output: `token #42 at /verify/42`
2. **Browser landing** — Show pitch, one-liner, "Verify" button
3. **Proof chain page** — Load `/verify/42`, show log entries rendering
4. **Log details** — Hover over entry, show tool name + input/output hashes
5. **Verify badge** — "TEE Verified" status appears (green checkmark + hex)

**What does NOT get demoed:**
- Light mode
- Multi-token history
- Transfer/ownership mechanics
- Mobile responsive (desktop-only for hackathon)

---

## Component specifications

### ProofChain (main container)

```
┌─────────────────────────────────────────┐
│ Session Metadata (top)                  │
│ ├─ Token ID: #42                        │
│ ├─ Session ID: 0xabc...def              │
│ ├─ Model: claude-sonnet-4-6             │
│ └─ Anchored: 2h ago                     │
├─────────────────────────────────────────┤
│ Log Entries (scrollable list)           │
│ ├─ [Entry 1: web_search]                │
│ ├─ [Entry 2: summarize]                 │
│ ├─ [Entry 3: format]                    │
│ └─ [Entry 4: final_check]               │
├─────────────────────────────────────────┤
│ Verification Summary (bottom)           │
│ ├─ ✓ TEE Verified (0x04581d...)         │
│ ├─ ✓ Storage Hash: 0xabc...             │
│ └─ [View on Explorer →]                 │
└─────────────────────────────────────────┘
```

- Metadata: 2-col grid (label/value pairs), background color = Surface
- Entries: Vertical list, each entry is a card with hover state
- Summary: Footer bar, border-top = Border color, aligned right

### LogEntry (card)

```
┌─────────────────────────────────────────┐
│ Seq.1 | web_search | ✓ Signed           │
│       (12px / secondary text)            │
│─────────────────────────────────────────│
│ Input:  0x1234... (32 chars hex)        │
│ Output: 0x5678... (32 chars hex)        │
│ Time:   14:32:15                        │
│─────────────────────────────────────────│
│ TEE: 0x04581d... | Verified             │
│                     (green status)      │
└─────────────────────────────────────────┘
```

- Card padding: lg (16px)
- Border: 1px solid Border color
- Hover: Lift (translate-y -2px) + shadow-md, border color → lighter
- Status badge: Rounded pill, green + checkmark for "Verified", amber for "Mock", red for "Unverified"

### StatusBadge (component)

```
✓ TEE Verified      (green bg, white text, rounded-full, inline)
⚠ Mock             (amber bg, dark text)
✗ Unverified       (red bg, white text)
```

- Padding: sm (8px) horizontal, xs (4px) vertical
- Font: 12px / Geist Sans regular
- Icon: Hardcoded checkmark/warning/X

---

## Interaction states checklist

### Button (CTA, "Verify a Proof")

- [x] **Hover** — translate-y -2px, shadow-md, 150ms ease-out
- [x] **Focus** — Focus ring (2px solid Accent color, offset 2px)
- [x] **Active/pressed** — translate-y 0, shadow-sm
- [x] **Disabled** — opacity 50%, cursor-not-allowed
- [x] **Empty** — N/A (always has text)
- [x] **Loading** — Spinner on left, text "Verifying..." (replace CTA text)
- [x] **Error** — Red border (2px), error message below

### ProofChain (page)

- [x] **Hover** — Card entries respond (see LogEntry below)
- [x] **Focus** — N/A (not interactive on page level)
- [x] **Active** — Entry selected (border-left = Accent color, 4px)
- [x] **Disabled** — N/A
- [x] **Empty** — "No entries found" message, centered, gray text
- [x] **Loading** — Skeleton cards (4 skeleton entries with shimmer)
- [x] **Error** — Full-page error banner: "Failed to load proof. Try again." (red bg, white text)

### LogEntry (card)

- [x] **Hover** — Border color shift, translate-y -2px, shadow-md
- [x] **Focus** — Focus ring on card
- [x] **Active** — Left border highlight (Accent color, 4px)
- [x] **Disabled** — Opacity 50%
- [x] **Empty** — N/A (always has data)
- [x] **Loading** — Skeleton row (3 skeleton bars)
- [x] **Error** — "Failed to load entry" placeholder (red text, 12px)

### StatusBadge

- [x] **Hover** — Slight brightening, no animation
- [x] **Focus** — N/A (not keyboard interactive)
- [x] **Active** — N/A
- [x] **Disabled** — Gray bg, gray text
- [x] **Empty** — N/A
- [x] **Loading** — Skeleton badge (rectangular)
- [x] **Error** — Red bg, "ERROR" text

---

## Banned Tailwind classes (project-specific)

- `from-purple-500 to-pink-500` (or any default AI gradient)
- `from-violet-600 to-indigo-600`
- `rounded-xl shadow-md` without explicit border-color (must pair with Border token)
- `text-gray-600` on white/light bg (use Text secondary token instead)
- `font-sans` without explicit `@import` for Geist (no system fonts)
- No `flex-1` spacers for primary layout strategy
- No centered hero with gradient background
- No mock avatar URLs (`ui-avatars.com`, `randomuser.me`)

---

## File structure (apps/dashboard/src/)

```
apps/dashboard/src/
├── app/
│   ├── layout.tsx          # Root layout: dark mode, Geist imports
│   ├── page.tsx            # Landing page
│   ├── verify/
│   │   └── [tokenId]/
│   │       └── page.tsx    # Proof chain detail
│   └── api/
│       └── verify/
│           └── [tokenId]/
│               └── route.ts    # GET endpoint
├── components/
│   ├── ProofChain.tsx      # Main container
│   ├── LogEntry.tsx        # Individual entry card
│   ├── StatusBadge.tsx     # Status indicator
│   └── Skeleton.tsx        # Loading placeholders
└── lib/
    └── client.ts           # API fetch wrapper
```

---

## Responsive behavior (desktop-only for hackathon)

- Minimum viewport: 1024px (desktop)
- No mobile optimization in scope
- Fixed-width max-content: 1280px

---

## Accessibility (required for demo)

- [ ] Semantic HTML: `<button>`, `<section>`, `<article>` (not divs)
- [ ] Focus ring on all interactive elements (2px solid Accent)
- [ ] Alt text on images (none in this demo, but codify for extension)
- [ ] Color contrast: Text primary (#F5F5F5) on Surface (#1A1B1F) = 16:1 (WCAG AAA)
- [ ] Keyboard nav: Tab through buttons, Enter to submit
