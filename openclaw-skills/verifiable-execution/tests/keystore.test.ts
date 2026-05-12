/**
 * Tests for src/keystore.ts — pre/post-mint key persistence + crash recovery.
 *
 * Uses a temp dir per-test so the real ~/.openclaw/ is never touched. Every
 * test cleans up its own fixtures.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey } from "../src/crypto.js";
import { Keystore } from "../src/keystore.js";

let root: string;
let ks: Keystore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ve-keystore-"));
  ks = new Keystore({ root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Keystore — ensureDirs", () => {
  it("creates the keystore + pending dirs with mode 0700 on first use", () => {
    const committedDir = join(root, "keystore");
    const pendingDir = join(committedDir, "pending");
    expect(existsSync(committedDir)).toBe(true);
    expect(existsSync(pendingDir)).toBe(true);
    // Unix-only mode check.
    if (process.platform !== "win32") {
      expect((statSync(committedDir).mode & 0o777).toString(8)).toBe("700");
      expect((statSync(pendingDir).mode & 0o777).toString(8)).toBe("700");
    }
  });

  it("re-creating Keystore over an existing dir is idempotent", () => {
    new Keystore({ root });
    new Keystore({ root });
    expect(existsSync(join(root, "keystore"))).toBe(true);
  });
});

describe("Keystore — put / get round-trip", () => {
  it("persists a key and reads it back identical", () => {
    const k = generateKey();
    ks.put("7", k);
    const got = ks.get("7");
    expect(got).not.toBeNull();
    expect(got!.equals(k)).toBe(true);
  });

  it("returns null when no key is stored for a tokenId", () => {
    expect(ks.get("nonexistent")).toBeNull();
  });

  it("rejects non-32-byte keys", () => {
    expect(() => ks.put("7", Buffer.alloc(16))).toThrow(/32 bytes/);
    expect(() => ks.put("7", Buffer.alloc(64))).toThrow(/32 bytes/);
  });

  it("writes key files with mode 0600 (no group/other readable)", () => {
    if (process.platform === "win32") return; // skip on Windows
    const k = generateKey();
    ks.put("7", k);
    const filePath = join(root, "keystore", "7.key");
    const mode = statSync(filePath).mode & 0o777;
    expect(mode.toString(8)).toBe("600");
  });
});

describe("Keystore — setPending / commitPending (crash-recovery ordering)", () => {
  it("setPending writes under pending/<sessionKey>.key", () => {
    const k = generateKey();
    ks.setPending("ses-xyz", k);
    expect(existsSync(join(root, "keystore", "pending", "ses-xyz.key"))).toBe(true);
  });

  it("commitPending promotes pending → committed and writes last-receipt pointer", () => {
    const k = generateKey();
    ks.setPending("ses-xyz", k);
    const ok = ks.commitPending("ses-xyz", "42");
    expect(ok).toBe(true);
    // Pending gone, committed present.
    expect(existsSync(join(root, "keystore", "pending", "ses-xyz.key"))).toBe(false);
    expect(existsSync(join(root, "keystore", "42.key"))).toBe(true);
    // Key bytes identical post-rename.
    expect(ks.get("42")!.equals(k)).toBe(true);
    // Last-receipt pointer updated.
    const last = ks.getLast();
    expect(last).toEqual({
      tokenId: "42",
      sessionKey: "ses-xyz",
      mintedAt: expect.any(Number),
    });
  });

  it("commitPending returns false when no pending key exists for that sessionKey", () => {
    const ok = ks.commitPending("ses-unknown", "999");
    expect(ok).toBe(false);
    expect(ks.get("999")).toBeNull();
  });

  it("survives a 'crash' between setPending and commitPending — pending key recoverable", () => {
    // Simulate: plugin sets pending, then process crashes (no commit).
    const k = generateKey();
    ks.setPending("ses-crashy", k);
    // Verify the operator can manually recover by inspecting pending/:
    const pendingPath = join(root, "keystore", "pending", "ses-crashy.key");
    expect(existsSync(pendingPath)).toBe(true);
    const recovered = readFileSync(pendingPath);
    expect(recovered.equals(k)).toBe(true);
    // Operator can then call commitPending with the eventually-known tokenId.
    expect(ks.commitPending("ses-crashy", "55")).toBe(true);
    expect(ks.get("55")!.equals(k)).toBe(true);
  });

  it("sanitizes sessionKeys containing OpenClaw's canonical `:` and `/` chars", () => {
    // Real OpenClaw sessionKey from VPS traces:
    //   "agent:core:telegram:direct:8028166336"
    const sk = "agent:core:telegram:direct:8028166336";
    const k = generateKey();
    ks.setPending(sk, k);
    // File should exist with `:` replaced by `_`.
    const sanitized = "agent_core_telegram_direct_8028166336";
    expect(existsSync(join(root, "keystore", "pending", sanitized + ".key"))).toBe(true);
    // commitPending using the SAME sessionKey resolves the same sanitized path.
    expect(ks.commitPending(sk, "100")).toBe(true);
    expect(ks.get("100")!.equals(k)).toBe(true);
  });
});

describe("Keystore — last-receipt pointer", () => {
  it("getLast returns null when no commits have happened", () => {
    expect(ks.getLast()).toBeNull();
  });

  it("getLast tracks the MOST RECENT commit (updates on each commitPending)", () => {
    const k1 = generateKey();
    const k2 = generateKey();
    ks.setPending("ses-1", k1);
    ks.commitPending("ses-1", "10");
    const after1 = ks.getLast();
    expect(after1?.tokenId).toBe("10");

    ks.setPending("ses-2", k2);
    ks.commitPending("ses-2", "11");
    const after2 = ks.getLast();
    expect(after2?.tokenId).toBe("11");
    expect(after2?.sessionKey).toBe("ses-2");
  });

  it("getLast tolerates a corrupt pointer file (returns null, doesn't throw)", () => {
    // Manually write invalid JSON.
    const corruptPath = join(root, "keystore", "last-receipt.json");
    require("node:fs").writeFileSync(corruptPath, "{not valid json");
    expect(ks.getLast()).toBeNull();
  });
});

describe("Keystore — list + remove", () => {
  it("list returns all committed tokenIds", () => {
    ks.put("7", generateKey());
    ks.put("8", generateKey());
    ks.put("9", generateKey());
    expect(ks.list().sort()).toEqual(["7", "8", "9"]);
  });

  it("remove deletes the key file and get() returns null after", () => {
    ks.put("7", generateKey());
    expect(ks.get("7")).not.toBeNull();
    ks.remove("7");
    expect(ks.get("7")).toBeNull();
  });

  it("remove on a missing tokenId is a no-op (no throw)", () => {
    expect(() => ks.remove("does-not-exist")).not.toThrow();
  });
});
