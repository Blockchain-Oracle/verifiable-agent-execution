/**
 * Tests for openclaw-skills/verifiable-execution/src/wallet.ts.
 *
 * Validates the xlmtools-style auto-wallet pattern:
 *   - PRIVATE_KEY env override → highest priority (source: "env")
 *   - Existing on-disk wallet → fast-path (source: "auto")
 *   - No env, no disk → fresh generation + persist (source: "fresh")
 *   - Corrupt/unparseable on-disk wallet → fall through to fresh
 *
 * Tests use a temp HOME directory so they don't touch the user's
 * real `~/.openclaw/verifiable-execution/wallet.json`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// resolveWallet uses os.homedir() to compute the config path. Stub
// homedir BEFORE importing the wallet module so each test gets an
// isolated config directory.
let tempHome: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

let walletModule: typeof import("../src/wallet.js");

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "openclaw-wallet-test-"));
  // Reset PRIVATE_KEY env between tests so env-override tests don't
  // contaminate disk-only tests.
  delete process.env.PRIVATE_KEY;
  // Re-import the module fresh on each test so the homedir mock
  // is re-evaluated. vi.resetModules clears the cache.
  vi.resetModules();
  walletModule = await import("../src/wallet.js");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  delete process.env.PRIVATE_KEY;
});

describe("resolveWallet — fresh generation (first run)", () => {
  it("generates a new wallet and persists to ~/.openclaw/verifiable-execution/wallet.json", () => {
    const result = walletModule.resolveWallet();
    expect(result.source).toBe("fresh");
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(result.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // File on disk
    const path = join(tempHome, ".openclaw", "verifiable-execution", "wallet.json");
    expect(existsSync(path)).toBe(true);
    // Address derives from privateKey
    const wallet = new Wallet(result.privateKey);
    expect(wallet.address).toBe(result.address);
  });

  it("persisted file has 0o600 permissions (private)", () => {
    walletModule.resolveWallet();
    const path = join(tempHome, ".openclaw", "verifiable-execution", "wallet.json");
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("resolveWallet — disk fast-path (subsequent runs)", () => {
  it("returns the same wallet on the second call (read from disk, source='auto')", () => {
    const first = walletModule.resolveWallet();
    expect(first.source).toBe("fresh");
    const second = walletModule.resolveWallet();
    expect(second.source).toBe("auto");
    expect(second.address).toBe(first.address);
    expect(second.privateKey).toBe(first.privateKey);
  });
});

describe("resolveWallet — env override", () => {
  it("PRIVATE_KEY env takes precedence over the on-disk wallet", () => {
    // Seed an on-disk wallet
    walletModule.resolveWallet();
    // Env-override with a known key (the wallet from session-anchor tests)
    process.env.PRIVATE_KEY = `0x${"1".repeat(64)}`;
    const result = walletModule.resolveWallet();
    expect(result.source).toBe("env");
    expect(result.privateKey).toBe(`0x${"1".repeat(64)}`);
    // Address must match the env-key's address, NOT the on-disk wallet's
    const expected = new Wallet(`0x${"1".repeat(64)}`).address;
    expect(result.address).toBe(expected);
  });

  it("empty PRIVATE_KEY env falls through to disk/fresh path", () => {
    process.env.PRIVATE_KEY = "";
    const result = walletModule.resolveWallet();
    expect(result.source).toBe("fresh");
  });
});

describe("resolveWallet — corrupt on-disk wallet HARD-FAILS (no silent regen)", () => {
  // Behavior pinned by Codex bot round-10 P1 on PR #23:
  // silent fallback to fresh-gen on a corrupt wallet file would
  // orphan a previously-funded keypair without any operator signal,
  // breaking session-identity continuity. Throw with a recovery hint
  // instead; force the operator to deliberately move/delete the file
  // to force fresh generation.

  it("throws when the on-disk file is unparseable JSON (does NOT regenerate silently)", () => {
    const dir = join(tempHome, ".openclaw", "verifiable-execution");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "wallet.json"), "this is not json");
    expect(() => walletModule.resolveWallet()).toThrow(/not valid JSON/);
    // Recovery hint: the error message should tell the operator how to fix it.
    expect(() => walletModule.resolveWallet()).toThrow(/Move\/delete the file/);
    // The corrupt file is preserved (NOT overwritten) so the operator can inspect it.
    expect(readFileSync(join(dir, "wallet.json"), "utf8")).toBe("this is not json");
  });

  it("throws when the file is missing privateKey field (does NOT regenerate silently)", () => {
    const dir = join(tempHome, ".openclaw", "verifiable-execution");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "wallet.json"),
      JSON.stringify({ address: "0xabc", createdAt: "..." }),
    );
    expect(() => walletModule.resolveWallet()).toThrow(/missing a valid privateKey/);
    expect(() => walletModule.resolveWallet()).toThrow(/Move\/delete the file/);
  });
});

describe("printFirstRunBanner", () => {
  it("only prints when source==='fresh' (no banner on subsequent runs)", () => {
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      walletModule.printFirstRunBanner({ privateKey: "0xfoo", address: "0xbar", source: "auto" });
      expect(stderrChunks.join("")).toBe("");
      walletModule.printFirstRunBanner({ privateKey: "0xfoo", address: "0xbar", source: "env" });
      expect(stderrChunks.join("")).toBe("");
      walletModule.printFirstRunBanner({ privateKey: "0xfoo", address: "0xbar", source: "fresh" });
      const out = stderrChunks.join("");
      expect(out).toContain("First Run Setup");
      expect(out).toContain("0xbar"); // wallet address surfaced
      expect(out).toContain("https://faucet.0g.ai"); // faucet URL surfaced
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

// Suppress unused-import warning since `homedir` is only referenced
// via the vi.mock block.
void homedir;
