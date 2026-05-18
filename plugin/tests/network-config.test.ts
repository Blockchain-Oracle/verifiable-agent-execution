/**
 * network-config.test.ts — covers the v0.4.0 persisted-network module:
 *   - preset shape (testnet + mainnet) matches our deployed contracts
 *   - savePersistedNetwork → loadPersistedNetwork round-trip
 *   - load returns null when no file exists / file is corrupt / network value invalid
 *   - chainIdToNetwork maps 16602 → testnet, 16661 → mainnet, anything else → unknown
 *
 * Tests use a temp HOME so they never touch the operator's real
 * ~/.agentscan/ — `process.env.HOME` is overridden per-test and the
 * tmp dir cleaned up in afterEach.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("network-config", () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "agentscan-net-test-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  });

  // ---- presets ----------------------------------------------------------

  describe("NETWORK_PRESETS", () => {
    it("has testnet preset matching Galileo (16602) and our Epic-7 deploys", async () => {
      const { NETWORK_PRESETS } = await import("../src/network-config.js");
      const t = NETWORK_PRESETS.testnet;
      expect(t.chainId).toBe(16602);
      expect(t.rpcUrl).toBe("https://evmrpc-testnet.0g.ai");
      expect(t.indexerUrl).toBe("https://indexer-storage-testnet-turbo.0g.ai");
      expect(t.agenticIdAddress).toBe("0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38");
      expect(t.verifierAddress).toBe("0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad");
      expect(t.verifyUrlBase).toBe("https://agentscan.online");
      expect(t.faucetUrl).toBe("https://faucet.0g.ai");
    });

    it("has mainnet preset matching Aristotle (16661) and our deployed contracts", async () => {
      const { NETWORK_PRESETS } = await import("../src/network-config.js");
      const m = NETWORK_PRESETS.mainnet;
      expect(m.chainId).toBe(16661);
      expect(m.rpcUrl).toBe("https://evmrpc.0g.ai");
      expect(m.indexerUrl).toBe("https://indexer-storage-turbo.0g.ai");
      expect(m.agenticIdAddress).toBe("0xC6f7fB1511a7483C6e14258c70529e37ec698937");
      expect(m.verifierAddress).toBe("0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2");
      expect(m.verifyUrlBase).toBe("https://mainnet.agentscan.online");
      // Mainnet doesn't ship a faucet (operators withdraw real 0G from a CEX).
      expect(m.faucetUrl).toBeUndefined();
    });

    it("presets are frozen — operators cannot mutate them at runtime", async () => {
      const { NETWORK_PRESETS } = await import("../src/network-config.js");
      expect(Object.isFrozen(NETWORK_PRESETS)).toBe(true);
    });
  });

  // ---- persistence round-trip -------------------------------------------

  describe("loadPersistedNetwork / savePersistedNetwork", () => {
    it("returns null when ~/.agentscan/network.json does not exist", async () => {
      const { loadPersistedNetwork } = await import("../src/network-config.js");
      expect(loadPersistedNetwork()).toBeNull();
    });

    it("save then load round-trips for mainnet", async () => {
      const { loadPersistedNetwork, savePersistedNetwork } = await import(
        "../src/network-config.js"
      );
      savePersistedNetwork("mainnet");
      expect(loadPersistedNetwork()).toBe("mainnet");
      // File should actually exist on disk where we expect it.
      expect(existsSync(join(tmpHome, ".agentscan", "network.json"))).toBe(true);
    });

    it("save then load round-trips for testnet", async () => {
      const { loadPersistedNetwork, savePersistedNetwork } = await import(
        "../src/network-config.js"
      );
      savePersistedNetwork("testnet");
      expect(loadPersistedNetwork()).toBe("testnet");
    });

    it("overwrites previous choice (mainnet → testnet)", async () => {
      const { loadPersistedNetwork, savePersistedNetwork } = await import(
        "../src/network-config.js"
      );
      savePersistedNetwork("mainnet");
      expect(loadPersistedNetwork()).toBe("mainnet");
      savePersistedNetwork("testnet");
      expect(loadPersistedNetwork()).toBe("testnet");
    });

    it("written file includes an updatedAt timestamp for auditability", async () => {
      const { savePersistedNetwork } = await import("../src/network-config.js");
      savePersistedNetwork("mainnet");
      const raw = readFileSync(join(tmpHome, ".agentscan", "network.json"), "utf8");
      const parsed = JSON.parse(raw) as { network: string; updatedAt: string };
      expect(parsed.network).toBe("mainnet");
      expect(typeof parsed.updatedAt).toBe("string");
      // Must parse as a valid ISO timestamp.
      expect(Number.isNaN(Date.parse(parsed.updatedAt))).toBe(false);
    });

    it("load returns null when file contains malformed JSON", async () => {
      const { loadPersistedNetwork } = await import("../src/network-config.js");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(join(tmpHome, ".agentscan", "network.json"), "{not valid json", "utf8");
      expect(loadPersistedNetwork()).toBeNull();
    });

    it("load returns null when network value is unknown (e.g. typo)", async () => {
      const { loadPersistedNetwork } = await import("../src/network-config.js");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".agentscan", "network.json"),
        JSON.stringify({ network: "mainet" }),
        "utf8",
      );
      expect(loadPersistedNetwork()).toBeNull();
    });

    it("load returns null when network field is missing", async () => {
      const { loadPersistedNetwork } = await import("../src/network-config.js");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".agentscan", "network.json"),
        JSON.stringify({ updatedAt: "2026-05-18T08:00:00Z" }),
        "utf8",
      );
      expect(loadPersistedNetwork()).toBeNull();
    });

    // Codex round-2 BLOCK: JSON.parse can return null / arrays / primitives,
    // and dereferencing .network on those throws TypeError. The detailed
    // loader must catch ALL non-object shapes and report them as corrupt
    // (not crash). Three cases below cover each branch.
    it("load returns null when file contains literal JSON `null` (does not throw)", async () => {
      const { loadPersistedNetwork, loadPersistedNetworkDetailed } = await import(
        "../src/network-config.js"
      );
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(join(tmpHome, ".agentscan", "network.json"), "null", "utf8");
      expect(() => loadPersistedNetwork()).not.toThrow();
      expect(loadPersistedNetwork()).toBeNull();
      const detailed = loadPersistedNetworkDetailed();
      expect(detailed.kind).toBe("corrupt");
      if (detailed.kind === "corrupt") {
        expect(detailed.reason).toContain("null");
      }
    });

    it("load returns null when file contains a JSON array (does not throw)", async () => {
      const { loadPersistedNetworkDetailed } = await import(
        "../src/network-config.js"
      );
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".agentscan", "network.json"),
        JSON.stringify(["mainnet"]),
        "utf8",
      );
      const detailed = loadPersistedNetworkDetailed();
      expect(detailed.kind).toBe("corrupt");
      if (detailed.kind === "corrupt") {
        expect(detailed.reason).toContain("array");
      }
    });

    it("load returns null when file contains a JSON primitive (string / number)", async () => {
      const { loadPersistedNetworkDetailed } = await import(
        "../src/network-config.js"
      );
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmpHome, ".agentscan"), { recursive: true });
      writeFileSync(join(tmpHome, ".agentscan", "network.json"), `"mainnet"`, "utf8");
      const detailed = loadPersistedNetworkDetailed();
      expect(detailed.kind).toBe("corrupt");
      if (detailed.kind === "corrupt") {
        expect(detailed.reason).toContain("string");
      }
    });

    it("creates ~/.agentscan/ directory when saving for the first time", async () => {
      const { savePersistedNetwork } = await import("../src/network-config.js");
      expect(existsSync(join(tmpHome, ".agentscan"))).toBe(false);
      savePersistedNetwork("mainnet");
      expect(existsSync(join(tmpHome, ".agentscan"))).toBe(true);
    });
  });

  // ---- chainId → network name -------------------------------------------

  describe("chainIdToNetwork", () => {
    it("maps 16602 → testnet", async () => {
      const { chainIdToNetwork } = await import("../src/network-config.js");
      expect(chainIdToNetwork(16602)).toBe("testnet");
    });

    it("maps 16661 → mainnet", async () => {
      const { chainIdToNetwork } = await import("../src/network-config.js");
      expect(chainIdToNetwork(16661)).toBe("mainnet");
    });

    it("returns 'unknown' for chainIds we don't recognize (custom configs)", async () => {
      const { chainIdToNetwork } = await import("../src/network-config.js");
      expect(chainIdToNetwork(1)).toBe("unknown");
      expect(chainIdToNetwork(31337)).toBe("unknown");
      expect(chainIdToNetwork(0)).toBe("unknown");
    });
  });
});
