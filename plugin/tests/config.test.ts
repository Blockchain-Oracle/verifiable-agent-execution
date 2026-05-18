/**
 * config.test.ts — v0.4.0 covers the persisted-network FORCED override
 * and corruption-warning behavior added in this release (Codex BLOCK-1
 * and BLOCK-3 fixes on initial v0.4.0 review).
 *
 * Tests override $HOME to a tmpdir so they never touch the real
 * ~/.agentscan/network.json file.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FULL_TESTNET_CONFIG = {
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  agenticIdAddress: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
  verifierAddress: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
  verifyUrlBase: "https://agentscan.online",
  chainId: 16602,
  modelId: "claude-sonnet-4-6",
};

const MAINNET_PRESET = {
  rpcUrl: "https://evmrpc.0g.ai",
  indexerUrl: "https://indexer-storage-turbo.0g.ai",
  agenticIdAddress: "0xC6f7fB1511a7483C6e14258c70529e37ec698937",
  verifierAddress: "0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2",
  verifyUrlBase: "https://mainnet.agentscan.online",
  chainId: 16661,
};

describe("resolveConfig — v0.4.0 persisted-network override", () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "agentscan-config-test-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  });

  // ---- baseline: no persisted file ---------------------------------------

  it("no persisted-network file → defaults to Galileo testnet (backwards compat)", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const r = resolveConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.chainId).toBe(16602);
      expect(r.config.rpcUrl).toBe("https://evmrpc-testnet.0g.ai");
      expect(r.networkOverride).toBeNull();
      expect(r.corruptNetworkWarning).toBeNull();
    }
  });

  it("no persisted-network file → explicit OpenClaw config wins over Galileo defaults", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const r = resolveConfig({
      ...FULL_TESTNET_CONFIG,
      // Pretend operator pinned a different RPC.
      rpcUrl: "https://my-private-rpc.example.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.rpcUrl).toBe("https://my-private-rpc.example.com");
      expect(r.networkOverride).toBeNull();
    }
  });

  // ---- BLOCK-1 fix: persisted network FORCES override --------------------

  it("persisted mainnet + empty OpenClaw config → mainnet preset wins, networkOverride set with no conflicts", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("mainnet");
    const r = resolveConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.chainId).toBe(MAINNET_PRESET.chainId);
      expect(r.config.agenticIdAddress).toBe(MAINNET_PRESET.agenticIdAddress);
      expect(r.config.verifierAddress).toBe(MAINNET_PRESET.verifierAddress);
      expect(r.config.verifyUrlBase).toBe(MAINNET_PRESET.verifyUrlBase);
      expect(r.config.rpcUrl).toBe(MAINNET_PRESET.rpcUrl);
      expect(r.config.indexerUrl).toBe(MAINNET_PRESET.indexerUrl);
      expect(r.networkOverride).toEqual({
        network: "mainnet",
        // Empty config = nothing to override = empty list.
        overriddenFields: [],
      });
    }
  });

  it("persisted mainnet + explicit TESTNET OpenClaw config → mainnet WINS and lists overridden fields", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("mainnet");
    const r = resolveConfig(FULL_TESTNET_CONFIG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Slash command outranks OpenClaw config for every network field.
      expect(r.config.chainId).toBe(MAINNET_PRESET.chainId);
      expect(r.config.agenticIdAddress).toBe(MAINNET_PRESET.agenticIdAddress);
      expect(r.config.verifyUrlBase).toBe(MAINNET_PRESET.verifyUrlBase);
      expect(r.networkOverride).not.toBeNull();
      expect(r.networkOverride?.network).toBe("mainnet");
      // Every network field differed → all six listed.
      expect(r.networkOverride?.overriddenFields.sort()).toEqual([
        "agenticIdAddress",
        "chainId",
        "indexerUrl",
        "rpcUrl",
        "verifierAddress",
        "verifyUrlBase",
      ]);
      // Identity fields (modelId) are NOT touched.
      expect(r.config.modelId).toBe("claude-sonnet-4-6");
    }
  });

  it("persisted testnet + explicit MAINNET OpenClaw config → testnet WINS", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("testnet");
    const r = resolveConfig({
      rpcUrl: MAINNET_PRESET.rpcUrl,
      indexerUrl: MAINNET_PRESET.indexerUrl,
      agenticIdAddress: MAINNET_PRESET.agenticIdAddress,
      verifierAddress: MAINNET_PRESET.verifierAddress,
      verifyUrlBase: MAINNET_PRESET.verifyUrlBase,
      chainId: MAINNET_PRESET.chainId,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.chainId).toBe(16602);
      expect(r.config.agenticIdAddress).toBe(FULL_TESTNET_CONFIG.agenticIdAddress);
      expect(r.networkOverride?.network).toBe("testnet");
      expect(r.networkOverride?.overriddenFields.length).toBe(6);
    }
  });

  it("persisted mainnet + OpenClaw config that already matches preset → no overridden fields reported", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("mainnet");
    const r = resolveConfig({
      rpcUrl: MAINNET_PRESET.rpcUrl,
      chainId: MAINNET_PRESET.chainId,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.networkOverride?.network).toBe("mainnet");
      // The config values match the preset, so nothing to flag as overridden.
      expect(r.networkOverride?.overriddenFields).toEqual([]);
    }
  });

  it("persisted mainnet does NOT touch identity-axis fields (agentId, modelId, privateKeyEnvVar)", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("mainnet");
    const r = resolveConfig({
      agentId: "0x3b566583b51DA4da8d95565212C96836f66433A3",
      modelId: "claude-opus-4-7",
      privateKeyEnvVar: "MY_CUSTOM_KEY",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Network fields = mainnet preset.
      expect(r.config.chainId).toBe(MAINNET_PRESET.chainId);
      // Identity fields = OpenClaw config (untouched).
      expect(r.config.agentId).toBe("0x3b566583b51DA4da8d95565212C96836f66433A3");
      expect(r.config.modelId).toBe("claude-opus-4-7");
      expect(r.config.privateKeyEnvVar).toBe("MY_CUSTOM_KEY");
    }
  });

  // ---- BLOCK-3 fix: corruption detection --------------------------------

  it("corrupt persisted-network file → resolveConfig sets corruptNetworkWarning + falls back to testnet defaults", async () => {
    const { resolveConfig } = await import("../src/config.js");
    mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentscan", "network.json"),
      "{not valid json at all",
      "utf8",
    );
    const r = resolveConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Fell back to testnet — no silent mainnet jump.
      expect(r.config.chainId).toBe(16602);
      expect(r.networkOverride).toBeNull();
      // But warning surfaces so register() can log loudly.
      expect(r.corruptNetworkWarning).not.toBeNull();
      expect(r.corruptNetworkWarning).toContain("unreadable");
    }
  });

  it("unknown network value in persisted file → corrupt warning, fall back to defaults", async () => {
    const { resolveConfig } = await import("../src/config.js");
    mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".agentscan", "network.json"),
      JSON.stringify({ network: "polygon", updatedAt: "2026-05-18T00:00:00Z" }),
      "utf8",
    );
    const r = resolveConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.chainId).toBe(16602);
      expect(r.corruptNetworkWarning).not.toBeNull();
      expect(r.corruptNetworkWarning).toContain("unreadable");
    }
  });

  it("invalid OpenClaw config (bad address) still returns ok:false — persisted-network does not paper over invalid input", async () => {
    const { resolveConfig } = await import("../src/config.js");
    const { savePersistedNetwork } = await import("../src/network-config.js");
    savePersistedNetwork("mainnet");
    // agentId is identity-axis, not network-axis → its validation still runs
    // even with persisted-network override active.
    const r = resolveConfig({ agentId: "not-an-address" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.invalid.some((s) => s.includes("agentId"))).toBe(true);
    }
  });
});
