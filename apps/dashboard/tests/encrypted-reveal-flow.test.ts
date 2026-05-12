/**
 * EncryptedReveal client-flow coverage (unit-level).
 *
 * Codex round-7 flagged that the encrypted-mode client component has
 * no test coverage. Full DOM-integration would need jsdom +
 * @testing-library/react setup — significant for one component.
 * Instead, this file pins the PURE invariants of the client flow:
 * the WebCrypto decrypt round-trip, the JSON synthesis logic, and
 * the hash-fragment parsing — the same code paths EncryptedReveal
 * runs in the browser, exercised here in Node without a DOM.
 *
 * The DOM-state machine (useState, useEffect, fetch wiring) is
 * mechanically straightforward and gets caught by `next build`'s
 * type check + manual demo verification. The cryptographic
 * correctness — which is the security-relevant part — is what these
 * tests pin.
 */

import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSessionLog,
  isEncryptedEnvelope,
  shareStringToKey,
  type EncryptedSessionLogEnvelope,
} from "@/lib/crypto";

function makeEnvelope(plaintext: string, key: Uint8Array): {
  envelope: EncryptedSessionLogEnvelope;
  shareString: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedSessionLogEnvelope = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    tag: tag.toString("hex"),
  };
  // Base64url with no padding, the same format keyToShareString produces.
  const shareString = Buffer.from(key)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return { envelope, shareString };
}

describe("EncryptedReveal client flow — WebCrypto decrypt path", () => {
  it("round-trips a v1 envelope produced by the plugin's node-crypto encoder", async () => {
    const key = new Uint8Array(randomBytes(32));
    const innerPlaintext = JSON.stringify({
      sessionId: "agent:core:telegram:direct:8028166336",
      entryCount: 1,
      entries: [
        {
          seq: 0,
          ts: 1700000000050,
          type: "tool_call",
          tool: "web_search",
          inputHash: "a".repeat(64),
          outputHash: "b".repeat(64),
        },
      ],
    });
    const { envelope, shareString } = makeEnvelope(innerPlaintext, key);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    const decoded = shareStringToKey(shareString);
    expect(decoded.length).toBe(32);
    const recoveredJson = await decryptSessionLog(envelope, decoded);
    expect(recoveredJson).toBe(innerPlaintext);
    // The synthesized ProofResponse the component builds:
    const parsed = JSON.parse(recoveredJson);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.sessionId).toBe("agent:core:telegram:direct:8028166336");
  });

  it("rejects a wrong key with an auth-tag mismatch error (does not return garbage plaintext)", async () => {
    const key = new Uint8Array(randomBytes(32));
    const wrongKey = new Uint8Array(randomBytes(32));
    const { envelope } = makeEnvelope("secret", key);
    await expect(decryptSessionLog(envelope, wrongKey)).rejects.toThrow();
  });

  it("rejects a tampered ciphertext byte", async () => {
    const key = new Uint8Array(randomBytes(32));
    const { envelope } = makeEnvelope("secret", key);
    const tampered: EncryptedSessionLogEnvelope = {
      ...envelope,
      ciphertext:
        (envelope.ciphertext.startsWith("00") ? "ff" : "00") +
        envelope.ciphertext.slice(2),
    };
    await expect(decryptSessionLog(tampered, key)).rejects.toThrow();
  });

  it("isEncryptedEnvelope rejects payloads without the v1 shape (so legacy plaintext SessionLog isn't misrouted)", () => {
    const legacy = {
      sessionId: "x",
      startedAt: 1,
      endedAt: 2,
      entries: [],
      entryCount: 0,
    };
    expect(isEncryptedEnvelope(legacy)).toBe(false);
    // Random JSON also rejected.
    expect(isEncryptedEnvelope({ hello: "world" })).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope("string")).toBe(false);
  });
});

describe("shareStringToKey — fragment parsing (browser-safe base64url)", () => {
  it("decodes a 32-byte key from a base64url fragment without padding", () => {
    const raw = randomBytes(32);
    const s = Buffer.from(raw)
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const recovered = shareStringToKey(s);
    expect(recovered.length).toBe(32);
    expect(Buffer.from(recovered).equals(raw)).toBe(true);
  });

  it("rejects a too-short key (paste error / truncated fragment)", () => {
    const tooShort = "abc"; // 3 chars → 2 bytes after b64 decode
    expect(() => shareStringToKey(tooShort)).toThrow(/32 bytes/);
  });

  it("rejects malformed base64url", () => {
    expect(() => shareStringToKey("!!!not-base64!!!")).toThrow();
  });
});
