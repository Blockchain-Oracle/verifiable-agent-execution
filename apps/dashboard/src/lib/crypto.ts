/**
 * crypto.ts — dashboard-side decryption helpers for v0.3.0 private receipts.
 *
 * Why duplicated from the plugin's `openclaw-skills/.../src/crypto.ts`:
 *   The plugin is an npm-published package that runs in OpenClaw's gateway
 *   process. The dashboard is a Next.js app. Cross-importing the plugin
 *   here would force the dashboard to depend on the plugin (wrong dep
 *   direction) OR require a third shared `packages/crypto` workspace
 *   package (overkill for ~60 LOC). We mirror the v1 envelope schema
 *   instead and keep both implementations in lockstep against the SPEC
 *   documented in the plugin's crypto.ts header.
 *
 * The dashboard only needs DECRYPT (not encrypt) — encryption happens
 * at plugin write-time. Decryption happens here when a viewer hits
 * /verify/<tokenId>?k=<base64url-key>.
 */

import { createDecipheriv } from "node:crypto";

export interface EncryptedSessionLogEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
}

/**
 * Type guard for the v1 envelope. Distinguishes encrypted receipts
 * (v0.3.0+) from legacy plaintext SessionLog blobs (token 0 + all
 * pre-v0.3.0 receipts). Dashboard's parse path branches on this:
 * envelope + key → decrypt + parse SessionLog; plaintext → parse
 * directly.
 */
export function isEncryptedEnvelope(
  value: unknown,
): value is EncryptedSessionLogEnvelope {
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

/**
 * Decrypt an envelope back to its plaintext SessionLog JSON. The key
 * arrives base64url-encoded in the share-link's `?k=` query param
 * (forwarded server-side after the client reads `window.location.hash`).
 *
 * Throws on:
 *   - unsupported version / algorithm
 *   - non-32-byte key (paste error guard)
 *   - malformed IV / tag (length mismatch)
 *   - GCM auth-tag mismatch (tampered ciphertext OR wrong key)
 *
 * `authTagLength: 16` is pinned defensively — without it, the decipher
 * silently accepts shorter tags which are trivially forgeable
 * (CWE-310). Defense-in-depth with the explicit `tag.length !== 16`
 * check above.
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
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Decode a base64url share-link key string back to raw 32 bytes.
 * Throws if the decoded form is anything other than 32 bytes.
 */
export function shareStringToKey(s: string): Buffer {
  const buf = Buffer.from(s, "base64url");
  if (buf.length !== 32) {
    throw new Error(`Decoded key must be 32 bytes; got ${buf.length}`);
  }
  return buf;
}
