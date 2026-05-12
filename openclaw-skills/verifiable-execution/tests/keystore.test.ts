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

  it("writes key files at the BDD-specified path `keystore/<tokenId>.key` with mode 0600", () => {
    if (process.platform === "win32") return; // skip on Windows
    const k = generateKey();
    ks.put("7", k);
    // Codex round-18: tokenId files use the LITERAL tokenId (digits
    // only — collision-free by construction). The pending-dir path
    // uses base64url encoding because sessionKeys CAN have `:`/`/`.
    const filePath = join(root, "keystore", "7.key");
    expect(existsSync(filePath)).toBe(true);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode.toString(8)).toBe("600");
  });

  it("rejects non-decimal tokenIds (defense in depth — would otherwise produce unsafe filenames)", () => {
    const k = generateKey();
    expect(() => ks.put("not-a-number", k)).toThrow(/decimal string/i);
    expect(() => ks.put("../escape", k)).toThrow(/decimal string/i);
    expect(() => ks.put("", k)).toThrow(/decimal string/i);
  });

  // BDD: "Then a file at keystore/<tokenId>.key exists with mode 0600
  //       And last-receipt.json is updated to point at this tokenId"
  // Codex round-1 caught that put() wrote the key but skipped the
  // last-receipt update, so /share with no args silently returned
  // "no receipts yet" after a direct put. This test pins the fix.
  it("updates last-receipt pointer so /share no-args returns the put tokenId", () => {
    const k = generateKey();
    ks.put("9", k);
    const last = ks.getLast();
    expect(last).not.toBeNull();
    expect(last!.tokenId).toBe("9");
    // sessionKey for direct-put has a synthetic marker so operators
    // can distinguish from agent_end commits.
    expect(last!.sessionKey).toBe("direct-put:9");
    expect(last!.mintedAt).toBeGreaterThan(0);
  });
});

describe("Keystore — setPending / commitPending (crash-recovery ordering)", () => {
  // Helper: convert sessionKey/tokenId → base64url filename (Codex
  // round-14 fix — replaces the old lossy `:`→`_` sanitization).
  const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");

  it("setPending writes under pending/<base64url(sessionKey)>.key", () => {
    const k = generateKey();
    ks.setPending("ses-xyz", k);
    expect(existsSync(join(root, "keystore", "pending", enc("ses-xyz") + ".key"))).toBe(true);
  });

  it("commitPending promotes pending → committed and writes last-receipt pointer", () => {
    const k = generateKey();
    ks.setPending("ses-xyz", k);
    const ok = ks.commitPending("ses-xyz", "42");
    expect(ok).toBe(true);
    // Pending uses base64url(sessionKey), committed uses literal tokenId
    // (Codex round-18: tokenId files at BDD-required path <tokenId>.key).
    expect(existsSync(join(root, "keystore", "pending", enc("ses-xyz") + ".key"))).toBe(false);
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
    const pendingPath = join(root, "keystore", "pending", enc("ses-crashy") + ".key");
    expect(existsSync(pendingPath)).toBe(true);
    const recovered = readFileSync(pendingPath);
    expect(recovered.equals(k)).toBe(true);
    // Operator can then call commitPending with the eventually-known tokenId.
    expect(ks.commitPending("ses-crashy", "55")).toBe(true);
    expect(ks.get("55")!.equals(k)).toBe(true);
  });

  it("encodes sessionKeys with OpenClaw's canonical `:` and `/` chars as base64url (collision-free)", () => {
    // Real OpenClaw sessionKey from VPS traces.
    const sk = "agent:core:telegram:direct:8028166336";
    const k = generateKey();
    ks.setPending(sk, k);
    // Codex round-14 fix: filename is base64url(sessionKey), not a
    // lossy `:` → `_` substitution. Don't hard-code the encoded form
    // here — assert the round-trip via listPending().
    const expectedEncoded = Buffer.from(sk, "utf8").toString("base64url");
    expect(existsSync(join(root, "keystore", "pending", expectedEncoded + ".key"))).toBe(true);
    // commitPending using the SAME sessionKey resolves the same path.
    expect(ks.commitPending(sk, "100")).toBe(true);
    expect(ks.get("100")!.equals(k)).toBe(true);
  });

  // BDD: "And the original sessionKey is recoverable by callers via listPending()"
  // Codex rounds 3 + 14: sanitization was lossy + colliding. Resolved
  // via base64url filename encoding (decodeFilename reverses it).
  it("listPending() returns the ORIGINAL sessionKey (decoded from filename)", () => {
    const sk = "agent:core:telegram:direct:8028166336";
    const k = generateKey();
    ks.setPending(sk, k);
    const pending = ks.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sessionKey).toBe(sk);
    // Filename is base64url(sessionKey) — verify round-trip rather
    // than hard-coding the bytes.
    expect(pending[0]?.sanitizedFilename).toBe(
      Buffer.from(sk, "utf8").toString("base64url"),
    );
    expect(typeof pending[0]?.createdAt).toBe("number");
  });

  // Cleanup invariant: after commitPending the sidecar is gone.
  it("commitPending removes the pending sidecar .meta.json (no leak)", () => {
    const sk = "ses:cleanup:check";
    const k = generateKey();
    ks.setPending(sk, k);
    const encoded = Buffer.from(sk, "utf8").toString("base64url");
    expect(existsSync(join(root, "keystore", "pending", encoded + ".meta.json"))).toBe(true);
    expect(ks.commitPending(sk, "777")).toBe(true);
    expect(existsSync(join(root, "keystore", "pending", encoded + ".meta.json"))).toBe(false);
    expect(ks.listPending()).toHaveLength(0);
  });

  // Codex round-14 P1 (SECURITY): old `:` → `_` sanitization caused
  // sessionKeys like "a:b" and "a/b" to collide on the same filename.
  // The collision let a second setPending overwrite the first pending
  // key file, so commitPending(sessionKey1, token1) could bind K2 to
  // token1 — a real cross-session key leak. Fix: base64url-encode the
  // FULL sessionKey for the filename (injective + reversible).
  it("colliding-sanitized sessionKeys 'a:b' and 'a/b' map to DISTINCT pending files (no overwrite)", () => {
    const kA = generateKey();
    const kB = generateKey();
    ks.setPending("a:b", kA);
    ks.setPending("a/b", kB);

    // Both pending entries must coexist.
    const pending = ks.listPending();
    expect(pending).toHaveLength(2);
    const recoveredKeys = pending.map((p) => p.sessionKey).sort();
    expect(recoveredKeys).toEqual(["a/b", "a:b"]);

    // Filenames must differ. With pre-round-14 sanitization both would
    // have been "a_b"; with base64url encoding they're different bytes
    // ("a:b" → "YTpi", "a/b" → "YS9i").
    const filenames = pending.map((p) => p.sanitizedFilename).sort();
    expect(filenames[0]).not.toBe(filenames[1]);

    // Committing one MUST NOT consume the other.
    expect(ks.commitPending("a:b", "111")).toBe(true);
    expect(ks.commitPending("a/b", "222")).toBe(true);
    expect(ks.get("111")!.equals(kA)).toBe(true);
    expect(ks.get("222")!.equals(kB)).toBe(true);
    // No cross-binding: token111 has K_A, NOT K_B.
    expect(ks.get("111")!.equals(kB)).toBe(false);
    expect(ks.get("222")!.equals(kA)).toBe(false);
  });

  // BDD crash-recovery: after a process restart with an in-progress
  // session, the operator can still recover the key + sessionKey from
  // disk and finish the commit.
  it("crash-recovery: pending key file + sidecar both recoverable from disk", () => {
    const sk = "ses:crash:integration";
    const k = generateKey();
    ks.setPending(sk, k);
    // Simulate restart: build a NEW Keystore pointing at the same root.
    const ks2 = new Keystore({ root });
    const pending = ks2.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sessionKey).toBe(sk);
    // Operator can finish the commit using the recovered sessionKey.
    expect(ks2.commitPending(sk, "8888")).toBe(true);
    expect(ks2.get("8888")!.equals(k)).toBe(true);
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
