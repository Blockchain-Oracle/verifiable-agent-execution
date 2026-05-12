/**
 * Tests for src/crypto.ts — AES-256-GCM round-trip + tamper detection.
 *
 * These tests pin the v1 envelope shape on-wire (the on-disk + on-storage
 * format that older dashboard builds in the wild may still need to decode
 * months from now). Schema drift = silent decryption failure across
 * versions, so every field is asserted explicitly.
 */

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSessionLog,
  encryptSessionLog,
  generateKey,
  isEncryptedEnvelope,
  keyToShareString,
  shareStringToKey,
  type EncryptedSessionLogEnvelope,
} from "../src/crypto.js";

const PLAINTEXT_SHORT = `{"hello":"world"}`;
const PLAINTEXT_LONG = JSON.stringify({
  sessionId: "ses-abc",
  entries: Array.from({ length: 50 }, (_, i) => ({
    seq: i,
    tool: "llm_call",
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
  })),
});

describe("generateKey", () => {
  it("returns 32 bytes of high-entropy randomness", () => {
    const k = generateKey();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });

  it("returns different keys on each call", () => {
    const k1 = generateKey();
    const k2 = generateKey();
    expect(k1.equals(k2)).toBe(false);
  });
});

describe("encryptSessionLog + decryptSessionLog round-trip", () => {
  it("encrypts then decrypts to identical plaintext (short)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    const recovered = decryptSessionLog(env, key);
    expect(recovered).toBe(PLAINTEXT_SHORT);
  });

  it("encrypts then decrypts to identical plaintext (multi-kilobyte)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_LONG, key);
    const recovered = decryptSessionLog(env, key);
    expect(recovered).toBe(PLAINTEXT_LONG);
  });

  it("emits an envelope with the exact v1 shape (pinned for cross-version compat)", () => {
    const env = encryptSessionLog(PLAINTEXT_SHORT, generateKey());
    expect(env.v).toBe(1);
    expect(env.alg).toBe("aes-256-gcm");
    // 12-byte IV → 24 hex chars
    expect(env.iv).toMatch(/^[0-9a-f]{24}$/);
    // 16-byte GCM tag → 32 hex chars
    expect(env.tag).toMatch(/^[0-9a-f]{32}$/);
    // ciphertext hex of even length
    expect(env.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(env.ciphertext.length % 2).toBe(0);
  });

  it("generates a unique IV per encryption call (catastrophic if reused)", () => {
    const key = generateKey();
    const e1 = encryptSessionLog(PLAINTEXT_SHORT, key);
    const e2 = encryptSessionLog(PLAINTEXT_SHORT, key);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
  });
});

describe("decryptSessionLog — tamper detection", () => {
  it("rejects a flipped ciphertext byte (auth tag mismatch)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    // Flip the first hex pair of ciphertext.
    const tampered: EncryptedSessionLogEnvelope = {
      ...env,
      ciphertext:
        (env.ciphertext.startsWith("00") ? "ff" : "00") + env.ciphertext.slice(2),
    };
    expect(() => decryptSessionLog(tampered, key)).toThrow();
  });

  it("rejects a flipped tag byte", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    const tampered: EncryptedSessionLogEnvelope = {
      ...env,
      tag: (env.tag.startsWith("00") ? "ff" : "00") + env.tag.slice(2),
    };
    expect(() => decryptSessionLog(tampered, key)).toThrow();
  });

  it("rejects a different key (wrong-key decryption fails)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    const wrongKey = generateKey();
    expect(() => decryptSessionLog(env, wrongKey)).toThrow();
  });
});

describe("decryptSessionLog — input validation", () => {
  it("rejects unsupported version", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    expect(() =>
      decryptSessionLog({ ...env, v: 2 as unknown as 1 }, key),
    ).toThrow(/Unsupported envelope version/);
  });

  it("rejects unsupported algorithm", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    expect(() =>
      decryptSessionLog(
        { ...env, alg: "aes-256-cbc" as unknown as "aes-256-gcm" },
        key,
      ),
    ).toThrow(/Unsupported algorithm/);
  });

  it("rejects non-32-byte key", () => {
    const env = encryptSessionLog(PLAINTEXT_SHORT, generateKey());
    expect(() => decryptSessionLog(env, randomBytes(16))).toThrow(/32 bytes/);
  });

  it("rejects malformed IV (wrong length)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    expect(() =>
      decryptSessionLog({ ...env, iv: "aa".repeat(8) /* 8 bytes */ }, key),
    ).toThrow(/IV must be 12 bytes/);
  });

  it("rejects malformed tag (wrong length)", () => {
    const key = generateKey();
    const env = encryptSessionLog(PLAINTEXT_SHORT, key);
    expect(() =>
      decryptSessionLog({ ...env, tag: "aa".repeat(8) /* 8 bytes */ }, key),
    ).toThrow(/GCM tag must be 16 bytes/);
  });
});

describe("encryptSessionLog — input validation", () => {
  it("rejects non-32-byte key", () => {
    expect(() => encryptSessionLog(PLAINTEXT_SHORT, randomBytes(16))).toThrow(
      /32 bytes/,
    );
    expect(() => encryptSessionLog(PLAINTEXT_SHORT, randomBytes(33))).toThrow(
      /32 bytes/,
    );
  });
});

describe("keyToShareString + shareStringToKey", () => {
  it("round-trips a key through base64url unchanged", () => {
    const k1 = generateKey();
    const s = keyToShareString(k1);
    const k2 = shareStringToKey(s);
    expect(k1.equals(k2)).toBe(true);
  });

  it("uses base64url (no `+` `/` `=`), URL-safe by construction", () => {
    // Force inputs that would naively produce all three replaceable chars.
    const k = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i * 7),
    );
    const s = keyToShareString(k);
    expect(s).not.toMatch(/[+/=]/);
  });

  it("rejects a too-short decoded key (paste error guard)", () => {
    expect(() => shareStringToKey("AAAA")).toThrow(/32 bytes/);
  });

  it("rejects a too-long decoded key", () => {
    const tooLong = keyToShareString(generateKey()) + "abcd";
    expect(() => shareStringToKey(tooLong)).toThrow(/32 bytes/);
  });
});

describe("isEncryptedEnvelope type guard", () => {
  it("returns true for a real envelope", () => {
    const env = encryptSessionLog(PLAINTEXT_SHORT, generateKey());
    expect(isEncryptedEnvelope(env)).toBe(true);
  });

  it("returns false for null / primitives", () => {
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope(undefined)).toBe(false);
    expect(isEncryptedEnvelope("string")).toBe(false);
    expect(isEncryptedEnvelope(42)).toBe(false);
  });

  it("returns false for a plaintext SessionLog (the legacy format)", () => {
    const plaintext = { sessionId: "ses-1", entries: [] };
    expect(isEncryptedEnvelope(plaintext)).toBe(false);
  });

  it("returns false for a partial envelope (missing tag)", () => {
    expect(
      isEncryptedEnvelope({
        v: 1,
        alg: "aes-256-gcm",
        iv: "00".repeat(12),
        ciphertext: "deadbeef",
        // tag missing
      }),
    ).toBe(false);
  });

  it("returns false for wrong version", () => {
    expect(
      isEncryptedEnvelope({
        v: 2,
        alg: "aes-256-gcm",
        iv: "00".repeat(12),
        ciphertext: "deadbeef",
        tag: "00".repeat(16),
      }),
    ).toBe(false);
  });
});
