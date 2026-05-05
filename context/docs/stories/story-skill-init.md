# Story: skill-init

**Epic:** Epic 4 — OpenClaw Skill
**Estimated time:** ~1h
**Dependencies:** None

---

## Narrative

As an OpenClaw integration developer, I need to scaffold an OpenClaw **plugin** named `verifiable-execution` using the canonical OpenClaw plugin layout (NOT a Claude-Code-style `SKILL.md`) so that lifecycle hooks (`onSessionStart`, `onToolCall`, `onSessionEnd`) can be registered cleanly and a `SessionLogger` can be allocated per session.

**Source of truth (verified by reading `0g-memory/openclaw-skills/evermemos/`):**
- The canonical OpenClaw plugin layout is `openclaw-skills/<plugin-id>/` containing `openclaw.plugin.json` + `package.json` + `src/index.ts`.
- The plugin entrypoint imports from `openclaw/plugin-sdk/core` and is typed via `OpenClawPluginApi`.
- There is **no** `SKILL.md` — that is a Claude Code skill convention, not OpenClaw. Earlier drafts of this story conflated the two.

---

## Acceptance criteria

```gherkin
Given the workspace root has the directory `openclaw-skills/verifiable-execution/`
And `openclaw-skills/verifiable-execution/openclaw.plugin.json` is created with:
  {
    "id": "verifiable-execution",
    "configSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "rpcUrl":            { "type": "string",  "description": "0G Chain RPC endpoint" },
        "indexerUrl":        { "type": "string",  "description": "0G Storage indexer endpoint" },
        "agenticIdAddress":  { "type": "string",  "description": "Pre-deployed AgenticID contract" },
        "verifierAddress":   { "type": "string",  "description": "Deployed MockTEEVerifier" },
        "verifyUrlBase":     { "type": "string",  "description": "Base URL of the verifier dashboard" },
        "privateKeyEnvVar":  { "type": "string",  "description": "Name of env var holding signer key (default PRIVATE_KEY)" }
      }
    }
  }
And `openclaw-skills/verifiable-execution/package.json` declares the plugin name + deps + `peerDependencies: { "openclaw": ">=*" }`
And `openclaw-skills/verifiable-execution/src/index.ts` is created with:
  - import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core"
  - export default function activate(api: OpenClawPluginApi): void { ... }
  - inside activate(): register onSessionStart, onToolCall, onSessionEnd handlers (stubs OK for this story)

When the plugin is installed via OpenClaw's plugin registry
Then the plugin id `verifiable-execution` appears in OpenClaw's loaded plugins
And the three lifecycle handlers fire on the appropriate session events
And configuration is read from openclaw.plugin.json's configSchema (validated against the schema by OpenClaw)

Given any required config field is missing
When the plugin is loaded
Then it logs a structured warning to stderr (NOT crashes the host)
And operates in degraded mode (no anchor; logs only) — rather than throwing

Given pnpm exec tsc --noEmit is run on the openclaw-skills/verifiable-execution package
Then it exits 0
```

---

## File modification map

**Create:**
- `openclaw-skills/verifiable-execution/openclaw.plugin.json` — plugin manifest with `id` + `configSchema`.
- `openclaw-skills/verifiable-execution/package.json` — declares the plugin module and its deps.
- `openclaw-skills/verifiable-execution/src/index.ts` — plugin entrypoint exporting `activate(api)` (default export).
- `openclaw-skills/verifiable-execution/src/SessionManager.ts` — singleton mapping `sessionId → SessionLogger`.
- `openclaw-skills/verifiable-execution/tests/skill.test.ts` — vitest harness with a fake OpenClawPluginApi.

**Update:**
- `pnpm-workspace.yaml` — register `openclaw-skills/*` so the workspace picks up plugin packages.

---

## Shell verification

```bash
# Compile only:
pnpm --filter=verifiable-execution exec tsc --noEmit
# Must exit 0.

# Manifest sanity:
jq -r '.id' openclaw-skills/verifiable-execution/openclaw.plugin.json
# Must print "verifiable-execution".
jq -r '.configSchema.type' openclaw-skills/verifiable-execution/openclaw.plugin.json
# Must print "object".

# Test scaffolding:
pnpm --filter=verifiable-execution test
# Must exit 0 with at least 1 passing test (lifecycle stubs registered).
```

---

## Notes for the coding agent

- **Reference plugin to study**: `0gfoundation/0g-memory/openclaw-skills/evermemos/`. Read all three files (`openclaw.plugin.json`, `package.json`, `src/index.ts`) before writing anything. The `evermemos` plugin is the canonical example of an OpenClaw plugin doing tool-call interception + flush-to-0G-Storage.
- **Do NOT create a `SKILL.md` file.** The artifact-consistency audit (2026-05-01) and the outwards audit (2026-05-05) both flagged this drift. OpenClaw uses `openclaw.plugin.json`, period.
- **Plugin layout root is `openclaw-skills/`, not `packages/openclaw-skill/`.** This matches `0g-memory/openclaw-skills/evermemos/` and lets future plugins (e.g. `openclaw-skills/audit-trail-v2/`) sit alongside without renaming.
- **Activate function signature:** `export default function activate(api: OpenClawPluginApi): void` — matches the SDK type. Side-effects (handler registration) happen inside.
- **Session lifecycle hooks** are registered through `api.onSessionStart(...)`, `api.onToolCall(...)`, `api.onSessionEnd(...)` — exact names are in `openclaw/plugin-sdk/core` types; check at implementation time, do NOT guess from this story.
- **Reference reading order:** `0gfoundation/0g-memory/openclaw-skills/evermemos/src/index.ts` → that plugin's manifest → this story.
