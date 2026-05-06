/**
 * Tests for openclaw-skills/verifiable-execution/src/index.ts (story-skill-init).
 *
 * BDD acceptance from context/docs/stories/story-skill-init.md (post-spec-evolution):
 *   - Default export is an OBJECT with {id, name, description, register}
 *     — NOT a default function activate(api). (The original BDD had this
 *     wrong; story updated to match the real OpenClaw API per
 *     0g-memory/openclaw-skills/evermemos and the SDK type definitions
 *     in openclaw@2026.5.4 plugin-sdk/src/plugins/types.d.ts:1886.)
 *   - register(api) reads pluginConfig + degrades gracefully on missing config
 *   - register(api) wires after_tool_call + session_end hooks via api.registerHook
 *   - Plugin never crashes the host on missing config (logs structured warning instead)
 *
 * Strategy: build a minimal fake OpenClawPluginApi with vi.fn spies for
 * registerHook + a mutable pluginConfig field so tests can exercise both
 * the happy-path and degraded-mode branches without standing up the full
 * OpenClaw runtime (which is the entire 74MB openclaw npm package).
 */

import { describe, expect, it, vi } from "vitest";

import plugin from "../src/index.js";
import { resolveConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_AGENT_ADDRESS = `0x${"a".repeat(40)}`;
const VALID_AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const VALID_VERIFIER_ADDRESS = `0x${"b".repeat(40)}`;

const FULL_CONFIG: Record<string, unknown> = {
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  agenticIdAddress: VALID_AGENTICID_ADDRESS,
  verifierAddress: VALID_VERIFIER_ADDRESS,
  verifyUrlBase: "https://verify.example.com",
  chainId: 16602,
  agentId: VALID_AGENT_ADDRESS,
  modelId: "claude-sonnet-4-6",
  // privateKeyEnvVar omitted — defaults to "PRIVATE_KEY"
};

/**
 * Build a fake OpenClawPluginApi minimal enough to drive register()
 * without typing the full 100+-method OpenClawPluginApi surface.
 * The cast through `unknown` is the conventional ethers-test-double
 * pattern in this repo (see chain-client tests for the same shape).
 */
function makeFakeApi(pluginConfig?: Record<string, unknown>): {
  api: Parameters<typeof plugin.register>[0];
  onSpy: ReturnType<typeof vi.fn>;
} {
  const onSpy = vi.fn();
  const api = {
    id: plugin.id,
    name: plugin.name,
    pluginConfig,
    on: onSpy,
    // The remaining OpenClawPluginApi methods are intentionally absent
    // — register() only touches `on` + pluginConfig, so the fake stays
    // small.
  } as unknown as Parameters<typeof plugin.register>[0];
  return { api, onSpy };
}

// ---------------------------------------------------------------------------
// Plugin shape (BDD: default export is OBJECT with {id, name, description, register})
// ---------------------------------------------------------------------------

describe("verifiable-execution plugin — shape", () => {
  it("exports an object with the OpenClaw-required {id, name, description, register} fields", () => {
    expect(plugin.id).toBe("verifiable-execution");
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name.length).toBeGreaterThan(0);
    expect(typeof plugin.description).toBe("string");
    expect(typeof plugin.register).toBe("function");
  });

  it("does NOT export a default function (rejects the original BDD's `activate(api)` shape)", () => {
    // Spec evolution: the original story-skill-init BDD used Claude
    // Code skill conventions (`export default function activate(api)`)
    // which doesn't match OpenClaw's actual plugin contract. This
    // test pins the corrected shape.
    expect(typeof plugin).not.toBe("function");
    expect(plugin).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      register: expect.any(Function),
    });
  });
});

// ---------------------------------------------------------------------------
// register() — happy path
// ---------------------------------------------------------------------------

describe("register() — happy path with full config", () => {
  it("registers after_tool_call and session_end hooks via api.registerHook", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);

    // Two hooks should be registered — after_tool_call + session_end.
    expect(onSpy).toHaveBeenCalledTimes(2);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toContain("after_tool_call");
    expect(events).toContain("session_end");
  });

  it("hook handlers are functions (the test fixtures, not undefined)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);

    for (const call of onSpy.mock.calls) {
      const handler = call[1];
      expect(typeof handler).toBe("function");
    }
  });

  it("does not throw on a fully valid config", () => {
    const { api } = makeFakeApi(FULL_CONFIG);
    expect(() => plugin.register(api)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// register() — degraded mode (BDD: missing config logs warning, NOT crashes)
// ---------------------------------------------------------------------------

describe("register() — degraded mode on missing config", () => {
  it("does not throw when pluginConfig is undefined", () => {
    const { api } = makeFakeApi(undefined);
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("does not throw when pluginConfig is empty object", () => {
    const { api } = makeFakeApi({});
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("still registers no-op hooks in degraded mode (so OpenClaw sees the plugin as healthy)", () => {
    const { api, onSpy } = makeFakeApi({});
    plugin.register(api);
    // Same number of hooks registered, same event names — only the
    // handler bodies differ (no-op vs real). This keeps the plugin
    // surface consistent so an operator can fix config + restart
    // without re-reading the registration log.
    expect(onSpy).toHaveBeenCalledTimes(2);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["after_tool_call", "session_end"]),
    );
  });

  it("does not throw when pluginConfig has only some fields filled in", () => {
    const partial = {
      rpcUrl: FULL_CONFIG.rpcUrl,
      indexerUrl: FULL_CONFIG.indexerUrl,
      // intentionally missing the rest
    };
    const { api } = makeFakeApi(partial);
    expect(() => plugin.register(api)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveConfig() — direct config-shape coverage (consumed by register())
// ---------------------------------------------------------------------------

describe("resolveConfig — config validation", () => {
  it("returns ok=true with all defaults when full config is supplied", () => {
    const result = resolveConfig(FULL_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.privateKeyEnvVar).toBe("PRIVATE_KEY");
      expect(result.config.chainId).toBe(16602);
      expect(result.config.agentId).toBe(VALID_AGENT_ADDRESS);
    }
  });

  it("reports ALL missing required fields in one go (not just the first)", () => {
    const result = resolveConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 7 required string/number fields (privateKeyEnvVar has a default
      // and is therefore not in `missing`).
      expect(result.missing.length).toBeGreaterThanOrEqual(7);
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "rpcUrl",
          "indexerUrl",
          "agenticIdAddress",
          "verifierAddress",
          "verifyUrlBase",
          "chainId",
          "agentId",
          "modelId",
        ]),
      );
    }
  });

  it("flags malformed addresses as 'invalid' (separate bucket from 'missing')", () => {
    const result = resolveConfig({
      ...FULL_CONFIG,
      agentId: "not-an-address",
      agenticIdAddress: "0xtoo-short",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid.some((s) => s.includes("agentId"))).toBe(true);
      expect(result.invalid.some((s) => s.includes("agenticIdAddress"))).toBe(true);
    }
  });

  it("uses a custom privateKeyEnvVar when supplied", () => {
    const result = resolveConfig({
      ...FULL_CONFIG,
      privateKeyEnvVar: "GALILEO_TESTNET_PRIVATE_KEY",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.privateKeyEnvVar).toBe("GALILEO_TESTNET_PRIVATE_KEY");
    }
  });

  it("rejects a non-integer / zero / negative chainId", () => {
    for (const bad of [0, -1, 1.5, "16602", null]) {
      const result = resolveConfig({ ...FULL_CONFIG, chainId: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.missing).toContain("chainId");
      }
    }
  });
});
