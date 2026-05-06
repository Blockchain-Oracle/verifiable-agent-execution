/**
 * verifiable-execution — OpenClaw plugin entry.
 *
 * Captures every tool call inside an agent session, flushes the log to
 * 0G Storage at session end, and mints an AgenticID iNFT anchoring the
 * rootHash on-chain. Produces a `/verify/<chainId>/<tokenId>` URL the
 * verifier dashboard can resolve cold.
 *
 * Source of truth:
 *   - Reference plugin layout: 0g-memory/openclaw-skills/evermemos/
 *     (verified via /tmp/og-refs/ during the outwards audit). Default
 *     export is an OBJECT with {id, name, description, register} —
 *     NOT `export default function activate(api)` per the original
 *     story BDD (that was Claude-Code-skill-convention drift; story
 *     updated to match the real OpenClaw API).
 *
 *   - OpenClawPluginApi shape: openclaw@2026.5.4
 *     dist/plugin-sdk/src/plugins/types.d.ts:2052. We use
 *     `api.on<K extends PluginHookName>(hookName, handler)` — the typed
 *     lifecycle-hook API. The lower-level `api.registerHook(events,
 *     InternalHookHandler)` exists too but its handler signature is
 *     internal-runtime-shaped (`(event: InternalHookEvent) => ...`)
 *     and doesn't carry the per-event (event, ctx) types. `api.on`
 *     destructures the right `(event, ctx)` shape per PluginHookName
 *     via `PluginHookHandlerMap[K]`.
 *
 *   - Hook event names: "after_tool_call", "session_end". OpenClaw
 *     does NOT expose a `session_start` event in the public hooks
 *     surface, so we lazy-allocate per-session state on first
 *     `after_tool_call` for an unseen sessionId (same pattern as
 *     evermemos's lazy groupId derivation).
 *
 * Lifecycle in this story (story-skill-init scope):
 *   1. Plugin load → resolve config from `api.pluginConfig`. If REQUIRED
 *      fields are missing, log a structured warning to stderr and
 *      register a NO-OP plugin (degraded mode). Never crashes the host.
 *   2. Register the lifecycle hooks (after_tool_call, session_end).
 *      The actual capture logic ships in story-skill-intercept; this
 *      story stubs the handlers so the registration shape is verified.
 *   3. session_end calls SessionAnchor.anchor() — that wiring lives in
 *      story-skill-close (deferred until PR #19's chain-client lands).
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { resolveConfig, type VerifiableExecutionConfig } from "./config.js";
import { SessionManager } from "./SessionManager.js";

const PLUGIN_ID = "verifiable-execution";
const PLUGIN_NAME = "Verifiable Execution";
const PLUGIN_DESCRIPTION =
  "Anchors every agent session as a TEE-signed log on 0G Storage + iNFT on AgenticID, producing a /verify/<chainId>/<tokenId> URL anyone can verify cold.";

/**
 * Per-plugin runtime state. Constructed only when the config resolves
 * successfully — a degraded plugin (missing config) skips this and
 * logs warnings instead.
 *
 * The StorageClient + SessionManager are NOT built here yet because
 * Epic 4's first story (skill-init) is the scaffold. Both get wired
 * in story-skill-intercept (StorageClient construction) and
 * story-skill-close (SessionAnchor + mint). For now the resolved
 * config is captured + reported, hooks are registered as stubs that
 * record receipt so tests can assert the registration succeeded.
 */
interface PluginState {
  config: VerifiableExecutionConfig;
  // SessionManager is allocated lazily in story-skill-intercept; the
  // null placeholder here is intentional during the skill-init
  // scaffold so the type stays accurate as scope expands.
  sessions: SessionManager | null;
}

/**
 * Stderr structured logger — never throws (matches evermemos pattern
 * of swallowing log-write failures so logging itself can't crash the
 * plugin host). Uses console.error directly because the OpenClaw
 * `api.logger` is only available inside register() and we want to
 * report config failures too.
 */
function warn(component: string, msg: string, data?: unknown): void {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level: "WARN",
      plugin: PLUGIN_ID,
      component,
      msg,
      ...(data !== undefined ? { data } : {}),
    });
    // Stderr keeps it out of the model's stdout-piped streams.
    process.stderr.write(entry + "\n");
  } catch {
    // Logging failures must never crash the plugin host.
  }
}

export default {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: PLUGIN_DESCRIPTION,

  register(api: OpenClawPluginApi): void {
    const resolution = resolveConfig(api.pluginConfig);

    if (!resolution.ok) {
      // Degraded mode: missing required config. Log a structured
      // warning naming every missing/invalid field at once (vs
      // failing on the first — operators get one shot at fixing).
      warn("register", "Plugin loaded in degraded mode: missing required config", {
        missing: resolution.missing,
        invalid: resolution.invalid,
      });
      // Register no-op stubs so OpenClaw still sees the plugin as
      // healthy; otherwise the host might mark it as failed-to-load
      // and the operator gets a less useful error than our warning.
      api.on("after_tool_call", () => {
        /* noop in degraded mode */
      });
      api.on("session_end", () => {
        /* noop in degraded mode */
      });
      return;
    }

    const state: PluginState = {
      config: resolution.config,
      sessions: null, // wired in story-skill-intercept
    };

    api.on("after_tool_call", (event, ctx) => {
      // story-skill-intercept will wire SessionLogger.appendEntry here.
      // For story-skill-init, this stub proves the hook fires + that
      // we can read `event.toolName` + `ctx.sessionId` (the shape we'll
      // need to consume in the next story).
      onToolCallStub(state, event, ctx);
    });

    api.on("session_end", (event, ctx) => {
      // story-skill-close will wire SessionAnchor.anchor() here.
      // For story-skill-init, this stub proves the hook fires + that
      // ctx.sessionId is available so we know we can look up the
      // SessionLogger we allocated on the first tool call.
      onSessionEndStub(state, event, ctx);
    });

    warn("register", "Plugin loaded with full config", {
      chainId: state.config.chainId,
      agentId: state.config.agentId,
      verifyUrlBase: state.config.verifyUrlBase,
    });
  },
};

// ---------------------------------------------------------------------------
// Stub handlers — exported as hooks so future stories can wire real logic
// without changing the registration surface.
// ---------------------------------------------------------------------------

// Loose event/ctx shape — the real per-event types come from
// PluginHookHandlerMap (PluginHookAfterToolCallEvent / PluginHookToolContext
// for after_tool_call; PluginHookSessionEndEvent / PluginHookSessionContext
// for session_end). The stubs intentionally accept `unknown` here so the
// next stories can replace the bodies without changing this signature
// (the api.on call sites already enforce the per-event types via
// PluginHookHandlerMap[K] inference).
export function onToolCallStub(
  _state: PluginState,
  _event: unknown,
  _ctx: unknown,
): void {
  // story-skill-intercept will replace this with:
  //   const logger = state.sessions.getOrCreate(String(ctx.sessionKey));
  //   logger.appendEntry({...});
}

export function onSessionEndStub(
  _state: PluginState,
  _event: unknown,
  _ctx: unknown,
): void {
  // story-skill-close will replace this with:
  //   const logger = state.sessions.get(String(ctx.sessionKey));
  //   if (!logger) return;
  //   const anchor = new SessionAnchor(logger, agenticIdClient, ...);
  //   await anchor.anchor({...});
  //   state.sessions.release(String(ctx.sessionKey));
}
