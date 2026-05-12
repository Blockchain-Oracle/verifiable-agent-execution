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
  - `id: "verifiable-execution"` and a `configSchema` declaring rpcUrl,
    indexerUrl, agenticIdAddress, verifierAddress, verifyUrlBase,
    chainId (REQUIRED — see "Spec evolution" on chainId-required), agentId,
    modelId, privateKeyEnvVar (defaults to "PRIVATE_KEY")
And `openclaw-skills/verifiable-execution/package.json` declares:
  - `name: "@verifiable-agent-execution/openclaw-skill"`
  - `openclaw.extensions: ["./src/index.ts"]` — the loader entrypoint
  - `peerDependencies: { "openclaw": ">=2026.5.0" }`
  - `dependencies` include `@verifiable-agent-execution/logger: "workspace:*"`
And `openclaw-skills/verifiable-execution/src/index.ts` exports:
  - the OpenClaw plugin OBJECT (NOT a function — see "Spec evolution"):
      export default {
        id: "verifiable-execution",
        name: "Verifiable Execution",
        description: "...",
        register(api: OpenClawPluginApi) { ... }
      }
  - inside register(api): wire `api.on("after_tool_call", ...)` and
    `api.on("session_end", ...)` lifecycle hooks (stubs OK for this
    story; real handlers ship in story-skill-intercept and
    story-skill-close)

When the plugin is installed via OpenClaw's plugin loader (config-side enable)
Then OpenClaw fires the registered hooks AUTOMATICALLY on every
  `after_tool_call` / `session_end` event — the AI agent does not need
  to know about or opt into the plugin (this is the whole point of
  hooks-vs-tools: hooks are runtime-fired, tools are agent-callable)
And configuration is read from openclaw.plugin.json's configSchema
  (validated against the schema by OpenClaw at load time)

Given any required config field is missing
When the plugin is loaded
Then it logs a structured warning to stderr (NOT crashes the host)
And operates in degraded mode: registers no-op stubs for after_tool_call
  + session_end so OpenClaw still sees the plugin as healthy, no anchor
  attempted

Given pnpm --filter @verifiable-agent-execution/openclaw-skill exec tsc --noEmit
Then it exits 0
And `pnpm --filter @verifiable-agent-execution/openclaw-skill test` exits 0 with at least 14 tests passing
```

### Spec evolution — corrections from the original BDD

The original draft had two bugs caught by reading the OpenClaw SDK
types directly + the canonical reference plugin `0g-memory/openclaw-skills/evermemos`:

1. **Plugin shape is OBJECT, not function**: original BDD said
   `export default function activate(api: OpenClawPluginApi): void`. The
   real OpenClaw contract is a default-exported OBJECT with
   `{id, name, description, register(api)}` (see evermemos line 218).
   `activate` is a Claude-Code-skill convention; OpenClaw uses `register`.
   Updated to match.

2. **Hook names are `api.on("after_tool_call", ...)`, not `onToolCall(...)`**:
   original BDD listed `onSessionStart, onToolCall, onSessionEnd` as
   methods on the api. The real API is `api.on<K extends PluginHookName>(K, handler)`
   where `K` is one of 35 typed hook names defined in
   `openclaw@2026.5.4/plugin-sdk/src/plugins/hook-types.d.ts:17`. The
   handler signature is per-hook via `PluginHookHandlerMap[K]` —
   `(event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext)`
   for `after_tool_call`, `(event, ctx)` of different types for each.
   Updated to use `api.on` + the real hook names. Note OpenClaw
   does NOT expose `session_start` as a public hook in the same way;
   we lazy-allocate per-session state on first `after_tool_call`
   (mirroring evermemos's lazy groupId pattern).

3. **chainId is REQUIRED in configSchema** — added per the same
   no-Galileo-default rule from story-session-mint (silent
   mainnet-URL leak risk on preview deploys). The configSchema field
   `chainId` is required at validation time; the plugin degrades to
   no-op if missing.

4. **v0.1.1 supersedes #3: defaults replace required fields.**
   When we tried to publish the plugin to npm (so end-users could run
   `openclaw plugins install @blockchainoracle/openclaw-verifiable-execution`
   and be done), OpenClaw 2026.4.25 rejected the install because its
   plugin-install pipeline validates `configSchema.required` against
   the entry it just created with an empty config block — a
   chicken-and-egg that no operator can resolve from the CLI alone.
   v0.1.1 moves validation from the JSON schema (declarative,
   install-time) into the TypeScript code (imperative, register-time):
   - `openclaw.plugin.json` drops `required`; every field is optional.
   - `src/config.ts` bakes Galileo testnet defaults (rpcUrl, indexer,
     contract addresses, chainId=16602, modelId) into resolveConfig.
   - Invalid overrides (malformed address, non-positive chainId) still
     fail loudly into degraded mode — we can't guess what the operator
     meant.
   - The first-run banner explicitly prints `Network: 0G Galileo
     testnet (chainId 16602)` so operators always know which network
     they're on. Mainnet still requires explicit override of every
     network field — no auto-switch. The "silent mainnet leak" risk
     from #3 is mitigated by the loud banner, not by a required field.

5. **v0.1.1 supersedes peer dep ">=2026.5.0".** The VPS test
   environment runs OpenClaw 2026.4.25 (current stable) and our
   plugin works correctly there. Bumping the peer to 2026.5.0 would
   lock out our own test environment for no functional gain — every
   API we depend on (`api.on`, `pluginConfig`) was stable from
   2026.4.x. peerDependencies is `">=2026.4.25"`.

---

## File modification map

**Create:**
- `openclaw-skills/verifiable-execution/openclaw.plugin.json` — plugin manifest with `id` + `configSchema`.
- `openclaw-skills/verifiable-execution/package.json` — declares the plugin module and its deps.
- `openclaw-skills/verifiable-execution/src/index.ts` — plugin entrypoint exporting a default OBJECT `{id, name, description, register(api)}` (NOT `activate(api)` — see "Spec evolution" above).
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
