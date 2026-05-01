# Story: skill-init

**Epic:** Epic 4 — OpenClaw Skill  
**Estimated time:** ~1h  
**Dependencies:** None

---

## Narrative

As an OpenClaw integration developer, I need a new OpenClaw skill that hooks into session lifecycle events and exposes a SessionLogger to capture tool calls.

---

## Acceptance criteria

```gherkin
Given `packages/openclaw-skill/SKILL.md` is created with:
  - skill name: `verifiable-execution`
  - description explaining what the skill does
  - metadata section with version, author
When `openclaw skills list` is run
Then `verifiable-execution` appears in the output

Given the skill's TypeScript entrypoint is at `packages/openclaw-skill/src/index.ts`
When it is imported in an OpenClaw context
Then it exports three functions:
  - onSessionStart(context) — initializes SessionLogger, returns context
  - onToolCall(context, toolName, input, output) — logs the tool call, returns context
  - onSessionEnd(context) — triggers flush + anchor, returns { verifyUrl }

And the SKILL.md explains how to install it
And it has at least basic error handling (no unhandled promise rejections)
```

---

## File modification map

**Create:**
- `packages/openclaw-skill/SKILL.md` — Skill metadata and usage docs
- `packages/openclaw-skill/src/index.ts` — Skill entrypoint with three lifecycle functions
- `packages/openclaw-skill/src/SessionManager.ts` — Singleton managing active SessionLogger per session
- `packages/openclaw-skill/package.json` — Skill package config

**Update:**
- `pnpm-workspace.yaml` — Register openclaw-skill package

---

## Shell verification

```bash
# Verify SKILL.md exists and has required sections:
grep -E "name:|description:|version:" packages/openclaw-skill/SKILL.md | wc -l
# Must be >= 3

# Verify TypeScript exports:
pnpm tsc --noEmit 2>&1 | grep -i "error" && echo "FAIL" || echo "PASS"
```
