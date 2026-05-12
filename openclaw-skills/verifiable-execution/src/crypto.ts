/**
 * crypto.ts — AES-256-GCM helpers for v0.3.0 private receipts.
 *
 * Why AES-256-GCM:
 *   - Authenticated encryption — auth tag detects ciphertext tampering
 *     without a separate HMAC pass.
 *   - First-class Node.js + WebCrypto support — no extra deps.
 *   - 12-byte IV is the canonical recommendation (NIST SP 800-38D §8.2);
 *     random IV per message gives ~2^32 message safety with 256-bit
 *     keys — sufficient for our use case (one IV per agent-session).
 *
 * Why NOT AES-256-CTR (0G storage-client's pattern):
 *   - 0G's CTR convention exists so their CLI can decrypt blobs uploaded
 *     by any client. We own BOTH encryption (plugin) and decryption
 *     (dashboard) — interoperability with 0G's CLI is not a requirement.
 *   - CTR has no built-in integrity; tampering is silent unless we add
 *     a separate HMAC. GCM gives us auth tag for free at the same cost.
 *   - Either choice is byte-compatible with 0G Storage (the indexer
 *     treats blobs as opaque bytes — research agent 3 confirmed).
 *
 * Why NOT a higher-level lib (Tink/Themis/libsodium):
 *   - Bundle size + extra deps. node:crypto + crypto.subtle (browser)
 *     are universal and audited.
 *   - The surface here is tiny — 60 LOC total. Wrong place to pull a
 *     framework.
 *
 * Threat model + accepted gaps:
 *   - Key in URL fragment is shareable forever once leaked. Accepted;
 *     documented in installation.md. No revocation primitive.
 *   - No forward secrecy across sessions — each token has its own key,
 *     so compromise of one tokenId's key leaks only that session.
 *   - No replay protection — entries are immutable; rootHash on-chain
 *     binds the ciphertext.
 *   - IV reuse with the same key would catastrophically break GCM
 *     confidentiality. We generate a fresh 12-byte random IV per
 *     encryption call AND use a fresh 32-byte random key per session,
 *     so even systematic IV-generation bias can't cause cross-session
 *     reuse.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * On-wire encrypted-blob envelope. Serialized as JSON and uploaded to
 * 0G Storage. The envelope's bytes are what the iNFT rootHash
 * commits to; integrity is preserved end-to-end by the rootHash even
 * before the consumer decrypts.
 *
 * Version field present so future cipher upgrades (e.g., post-quantum)
 * can coexist with v1 blobs in the wild. Consumers MUST reject
 * unknown versions rather than guessing.
 */
export interface EncryptedSessionLogEnvelope {
  /** Wire format version. v1 = AES-256-GCM with 12-byte IV + 16-byte tag. */
  v: 1;
  /** Cipher identifier (informational; v=1 implies aes-256-gcm). */
  alg: "aes-256-gcm";
  /** 12-byte IV, hex (no 0x prefix). */
  iv: string;
  /** Ciphertext bytes, hex (no 0x prefix). */
  ciphertext: string;
  /** 16-byte GCM auth tag, hex (no 0x prefix). */
  tag: string;
}

/**
 * Generate a fresh 256-bit symmetric key. One key per agent session.
 *
 * Returns a `Buffer` (Node) — consumers can `.toString("base64url")`
 * for the URL fragment OR keep raw bytes for keystore persistence.
 */
export function generateKey(): Buffer {
  return randomBytes(32);
}

/**
 * Encrypt a UTF-8 plaintext (typically `JSON.stringify(SessionLog)`)
 * into an envelope. Generates a fresh random 12-byte IV per call.
 *
 * Throws on invalid key length (must be exactly 32 bytes for AES-256).
 * Throws are propagated so a misuse loud-fails rather than silently
 * producing weakly-protected ciphertext.
 */
export function encryptSessionLog(
  plaintext: string,
  key: Buffer,
): EncryptedSessionLogEnvelope {
  if (key.length !== 32) {
    throw new Error(`Key must be 32 bytes (AES-256); got ${key.length}`);
  }
  const iv = randomBytes(12);
  // Pin authTagLength to 16 bytes (full GCM tag) on both encrypt + decrypt
  // sides. Without this, decryption silently accepts shorter tags which
  // are exponentially easier to forge (CWE-310). semgrep correctly flags
  // a missing authTagLength here; passing it explicitly is the fix.
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    tag: tag.toString("hex"),
  };
}

/**
 * Decrypt an envelope back to the original UTF-8 plaintext.
 *
 * Throws on:
 *   - unsupported version
 *   - non-32-byte key
 *   - malformed hex
 *   - GCM auth-tag mismatch (ciphertext or IV tampered)
 *
 * The auth-tag check is what lets a verifier prove "this ciphertext
 * decodes to exactly this plaintext, undetected tampering is
 * impossible." That's the property the on-chain rootHash + envelope
 * combination gives us for free vs CTR-mode.
 */
export function decryptSessionLog(
  envelope: EncryptedSessionLogEnvelope,
  key: Buffer,
): string {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }
  if (envelope.alg !== "aes-256-gcm") {
    throw new Error(`Unsupported algorithm: ${envelope.alg}`);
  }
  if (key.length !== 32) {
    throw new Error(`Key must be 32 bytes (AES-256); got ${key.length}`);
  }
  const iv = Buffer.from(envelope.iv, "hex");
  const ciphertext = Buffer.from(envelope.ciphertext, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  if (iv.length !== 12) {
    throw new Error(`IV must be 12 bytes; got ${iv.length}`);
  }
  if (tag.length !== 16) {
    throw new Error(`GCM tag must be 16 bytes; got ${tag.length}`);
  }
  // Pin authTagLength=16 (full GCM tag) — must match encrypt side. Without
  // this option, decipher silently accepts shorter tags which are
  // exponentially easier to forge. CWE-310. The explicit `tag.length !== 16`
  // throw above ALSO protects, but pinning via the option is the
  // primary defense; defense-in-depth.
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  // decipher.final() throws on auth-tag mismatch — exactly the
  // tamper-detection behavior we want. Don't catch + return null;
  // surface the throw so callers know decryption FAILED rather than
  // silently using an "empty" SessionLog.
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Encode a raw key to base64url (URL-safe, no padding) for embedding
 * in a share-link fragment: `https://verifiable.0g.ai/verify/N#k=...`
 *
 * The `url` flavor avoids `+` `/` `=` which break URL parsing in
 * some contexts (Telegram link previews truncate at `=`, etc.).
 */
export function keyToShareString(key: Buffer): string {
  return key.toString("base64url");
}

/**
 * Decode a share-link key string back to raw 32 bytes. Throws if the
 * encoded form decodes to anything other than 32 bytes (defends
 * against operators pasting half a key, etc.).
 */
export function shareStringToKey(s: string): Buffer {
  const buf = Buffer.from(s, "base64url");
  if (buf.length !== 32) {
    throw new Error(`Decoded key must be 32 bytes; got ${buf.length}`);
  }
  return buf;
}

/**
 * Type guard — detects whether a parsed JSON object is an
 * EncryptedSessionLogEnvelope (vs a plaintext SessionLog from
 * pre-v0.3.0 anchored sessions). The dashboard uses this to branch
 * the render path; old plaintext blobs (token 0, all pre-v0.3.0
 * Telegram sessions) keep working without a key.
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedSessionLogEnvelope {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    v.alg === "aes-256-gcm" &&
    typeof v.iv === "string" &&
    typeof v.ciphertext === "string" &&
    typeof v.tag === "string"
  );
}
