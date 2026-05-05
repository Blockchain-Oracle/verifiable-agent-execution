# CLAUDE.md — verifiable-agent-execution

_Updated: 2026-05-01. Managed by sahil-coding-protocol._

## What this is

[One paragraph: what problem this project solves, who uses it, what it does.]

## Stack

[List: language + framework + main deps + deploy target. One line per item.]

## Top-3 commands

```bash
.claude/scripts/green-light.sh   # full gate: tests + lint + types + visual + §14 grep
pnpm dev                          # or npm run dev / cargo run / python main.py
pnpm test                         # or pytest / cargo test / forge test
```

## Library research rule (mandatory)

Before implementing ANYTHING from scratch, you must check Context7 first:

```bash
# Step 1: find the library
mcp__context7__resolve-library-id libraryName="<what you need>"

# Step 2: read the docs
mcp__context7__query-docs context7CompatibleLibraryID="<id>" topic="<specific area>" tokens=5000
```

**If a library exists that solves it, use it. Do not build it yourself.**

This applies to: UI components, form validation, state management, auth, animations, chart/data viz, date handling, file uploads, websockets, crypto primitives — everything.

## Required external libraries (use these, do not reinvent)

[Fill in from SPEC.md Dependencies section. Example:]

| Library | Purpose | How to add |
|---|---|---|
| `zod` | Schema validation | `pnpm add zod` |
| `zustand` | Global state | `pnpm add zustand` |
| `framer-motion` | Animations + transitions | `pnpm add framer-motion` |
| Magic UI | Animated hero components | Copy from magicui.design (MIT) |
| `@anthropic-ai/sdk` | Claude API | `pnpm add @anthropic-ai/sdk` |

## Rules for this repo

[Anti-patterns specific to this codebase. Grows over time as agents burn themselves.]

- Never use `from-purple-500 to-pink-500` or any default Tailwind purple gradient
- Never use `font-sans` without an explicit font import (Inter default = slop)
- All React state goes through Zustand — never local useState for shared state
- `§14 grep gate` must be clean: no mock/fake/dummy/hardcoded in hot path
- Never write "John Doe", "lorem ipsum", or "$1,234.56" — use realistic demo data

## BDD acceptance criteria

Read `SPEC.md` for the full list. For each story you implement:
1. Read the Given/When/Then criteria for that story
2. Write the tests FIRST (ATDD — tests come before implementation)
3. Implement until `pnpm test` passes those specific scenarios
4. Check `.claude/last-review.json` after every UI edit — fix before continuing

## Anchor products

[UI reference products, if applicable. Links to screenshots/anchor/.]

- Product: [name + URL]
- Anchor screenshots: `screenshots/anchor/` — immutable, never overwrite
- Design tokens: primary [hex], secondary [hex], font [name], spacing [system]

## Known pitfalls

[Things that have already burned an agent. Grows over time.]

## Where things live

- **SPEC.md (3-field brief):** `SPEC.md` at repo root — read this first for every task
  - Generated from story file: `research/0g-apac-2026/docs/stories/story-<slug>.md` (if hackathon project)
  - Contains: Goal, Constraints, Acceptance (extracted from story file)
- **Story file (full context):** `research/0g-apac-2026/docs/stories/story-<slug>.md`
  - Includes: user story, file map, BDD criteria, shell verification, notes for agents
  - Read this for context beyond the 3-field brief
- **Architecture + PRD:** `research/0g-apac-2026/docs/architecture.md` + `docs/PRD.md` (locked after Abu approval)
- **Anchor screenshots:** `screenshots/anchor/`
- **Visual test baselines:** `screenshots/baseline/`
- **Reviewer output:** `.claude/last-review.json`
- **PR audit:** `.claude/last-audit.md`
- **Green-light log:** `.claude/green-light.log`

## CI requirement

`.github/workflows/ci.yml` must stay green on every commit. If CI is red:
1. Stop current work
2. Fix the CI failure
3. Re-run green-light.sh
4. Then continue

Never merge a PR while CI is red.

<!-- Append this block to CLAUDE.md at project root -->

## Visual validation loop (enforced)

This project has a screenshot validation loop wired. It runs automatically. Do not skip it, do not disable it, do not change `screenshots/anchor/*` after day-0.

### What's wired

- `screenshots/anchor/` — captured day-0 from the anchor product. **Immutable.** Never overwrite.
- `screenshots/baseline/` — Playwright `toHaveScreenshot()` baselines. Update via `--update-snapshots` only when an intentional UI change is approved.
- `screenshots/current/` — last run output. Gitignored.
- `tests/visual/pages.spec.ts` — visual regression spec. Run with `pnpm exec playwright test`.
- `.claude/hooks/visual-check.sh` — fires on every Edit/Write that touches `app/**`, `components/**`, `*.tsx`. Writes verdict to `.claude/last-review.json`.
- `.claude/hooks/visual_reviewer.py` — Anthropic SDK vision reviewer. Reads anchor + current, returns slop-detection JSON.

### Rules for the agent (you, Claude Code)

1. **After every UI edit, check `.claude/last-review.json`.** If `verdict !== "ok"`, address every `blocking` and `high` delta before continuing.
2. **DESIGN.md is the source of truth** for palette, typography, spacing. If a token isn't in DESIGN.md, do not invent one. Ask.
3. **Never use these defaults** (auto-fail on review):
   - `from-purple-500 to-pink-500`, `from-violet-* to-indigo-*` gradients
   - `rounded-xl shadow-md` cards without custom border-color
   - `text-gray-600` body copy on white bg
   - `font-sans` without an explicit font import
   - "John Doe" / "Lorem ipsum" / "$1,234.56" / `ui-avatars.com` placeholders
4. **Anchor is the floor.** If the build looks worse than the anchor at thumbnail, it's slop, regardless of what the slop_score says.
5. **Multi-viewport.** Every component must look correct at desktop / mobile / tablet. Slop hides at mobile widths.

### Common reviewer states

- `"ok"` (slop_score 0–2, blocking 0) — proceed to next task.
- `"needs-fix"` (3–6 or any blocking) — list deltas, fix in order: blocking → high → medium → low. Re-run reviewer.
- `"slop"` (7+ or 3+ slop tells) — stop. Re-read DESIGN.md. Probably the palette or the structural layout is wrong.
- `"skipped"` — dev server down, or anchor missing. Get unblocked, re-run.

### Manual review

Run `/visual-review` for an ad-hoc check, or `/visual-review mobile` for a specific viewport.

**Anchor product (captured day-0):** https://trigger.dev
**Anchor screenshots:** screenshots/anchor/ — NEVER overwrite these.
