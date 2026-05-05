# DESIGN.md — Verifiable Agent Execution

> **Source of truth for visual design: [`ux-spec.md`](./ux-spec.md).**
>
> This file previously held a parallel design system that diverged from `ux-spec.md` on
> several palette tokens (Surface elevated, Border, Text primary, Verify accent) and
> on information architecture (DESIGN.md proposed a 240px sidebar with a Recent-runs
> nav; ux-spec.md is sidebar-less). The story file `story-verifier-ui.md` follows
> `ux-spec.md`, so to remove ambiguity for the coding agent, this file now defers to it.

---

## What lives where

| Topic | File |
|---|---|
| Anchor product, palette, typography, spacing, motion, banned classes | `context/docs/ux-spec.md` |
| Component layouts, BDD acceptance for the UI | `context/docs/stories/story-verifier-ui.md` |
| Backed by anchor screenshots | `screenshots/anchor/` (captured from `https://trigger.dev`) |

If you find a design decision that is not answered by `ux-spec.md`, do not invent
a new token here. Either ask, or extend `ux-spec.md` directly so there remains
exactly one source of truth.

---

## Coding-agent rules carried forward (also enforced by `.claude/hooks/visual-check.sh`)

These were duplicated in the old DESIGN.md and remain enforced. They are
documented here only as a CI-aid; the canonical statement of each is in
`ux-spec.md` §"Banned Tailwind classes" and in `CLAUDE.md` §"Rules for this repo".

- No `from-purple-500 to-pink-500` or any default Tailwind purple/pink/violet/indigo gradient
- No `rounded-xl shadow-md` cards without an explicit border-color paired from the ux-spec palette
- No `text-gray-600` body copy on a charcoal background — use the secondary-text token
- No `font-sans` without an explicit Geist (`npm install geist`) import
- No `John Doe` / lorem ipsum / `$1,234.56` / `ui-avatars.com` placeholder data
- Desktop-only viewport (≥1024px) for the hackathon scope; mobile is out of scope

---

## Why this consolidation

Audited 2026-05-01. Discovered the two files specified different values for:
`Surface elevated` (`#2C3034` vs `#22252D`), `Border` (`#272A2E` vs `#363A45`),
`Text primary` (`#D7D9DD` vs `#F5F5F5`), `Verified accent` (`#22C55E` vs `#10B981`),
and incompatible information architectures (sidebar vs no-sidebar, three pages
vs two). `ux-spec.md` won because `story-verifier-ui.md` already references its
route shape, palette, and component breakdown.
