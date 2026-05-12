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
 * **WebCrypto, not node:crypto.** Earlier revisions used Node's
 * `createDecipheriv` API, but this module is imported by the
 * `EncryptedReveal` client component — Next.js webpack rejects
 * `node:crypto` in client bundles (`next build` fails). WebCrypto
 * (`globalThis.crypto.subtle`) is available in both Node 20+ (server
 * components / route handlers) and every modern browser, so one
 * implementation runs in both runtimes. AES-GCM is a Web standard.
 *
 * The dashboard only needs DECRYPT (not encrypt) — encryption happens
 * at plugin write-time. Decryption happens client-side in the browser
 * when EncryptedReveal reads `window.location.hash` for `#k=...`.
 */

/** Decoded base64url key — always 32 raw bytes for AES-256. */
export type SessionKey = Uint8Array;

export interface EncryptedSessionLogEnvelope {
  v: 1;
  /**
   * Wire format alg name — lowercase to match the on-wire bytes the
   * plugin's node:crypto encrypter produces (`createCipheriv("aes-256-gcm",
   * ...)`). The Node identifier and the WebCrypto identifier differ
   * (`"aes-256-gcm"` vs `"AES-GCM"`); we normalize to the Node form
   * because the plugin writes the envelope and that's what's on
   * storage.
   */
  alg: "aes-256-gcm";
  /** 12-byte IV, hex (no 0x prefix). */
  iv: string;
  /** Ciphertext bytes, hex (no 0x prefix). */
  ciphertext: string;
  /** 16-byte GCM auth tag, hex (no 0x prefix). */
  tag: string;
}

/**
 * Type guard for the v1 envelope. Distinguishes encrypted receipts
 * (v0.3.0+) from legacy plaintext SessionLog blobs (token 0 + all
 * pre-v0.3.0 receipts). Dashboard's parse path branches on this:
 * envelope detected → server returns key-blind locked state; plaintext
 * → server returns full entries.
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
 * Decode a hex string (no 0x prefix) into raw bytes. Mirrors the
 * plugin's wire encoding for envelope fields.
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string has odd length: ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex byte at offset ${i * 2}: "${hex.slice(i * 2, i * 2 + 2)}"`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Concatenate two Uint8Arrays into one. WebCrypto's AES-GCM decrypt
 * expects ciphertext + tag as a single buffer (unlike Node's API which
 * takes them as separate setAuthTag()/update() calls).
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Decrypt a v1 envelope back to its plaintext SessionLog JSON using
 * WebCrypto's AES-GCM primitive. Runs in both Node 20+ (route
 * handlers) and the browser (EncryptedReveal client component).
 *
 * Throws on:
 *   - unsupported version / algorithm
 *   - non-32-byte key (paste error guard)
 *   - malformed IV / tag (length mismatch)
 *   - GCM auth-tag mismatch (tampered ciphertext OR wrong key)
 *
 * The 16-byte tag is part of the standard GCM auth check —
 * `crypto.subtle.decrypt` rejects any envelope whose tag doesn't
 * verify, so we get authenticated decryption for free without a
 * separate `setAuthTag()` call (the WebCrypto API treats the
 * `cipherWithTag` last 16 bytes as the auth tag automatically when
 * `tagLength: 128` is passed).
 */
export async function decryptSessionLog(
  envelope: EncryptedSessionLogEnvelope,
  key: SessionKey,
): Promise<string> {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }
  if (envelope.alg !== "aes-256-gcm") {
    throw new Error(`Unsupported algorithm: ${envelope.alg}`);
  }
  if (key.length !== 32) {
    throw new Error(`Key must be 32 bytes (AES-256); got ${key.length}`);
  }
  const iv = hexToBytes(envelope.iv);
  const ciphertext = hexToBytes(envelope.ciphertext);
  const tag = hexToBytes(envelope.tag);
  if (iv.length !== 12) {
    throw new Error(`IV must be 12 bytes; got ${iv.length}`);
  }
  if (tag.length !== 16) {
    throw new Error(`GCM tag must be 16 bytes; got ${tag.length}`);
  }
  // WebCrypto wants ciphertext + tag as a single buffer.
  const cipherWithTag = concatBytes(ciphertext, tag);
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("crypto.subtle is unavailable in this runtime");
  }
  // The `as BufferSource` casts work around a TS strictness quirk:
  // `Uint8Array<ArrayBufferLike>` doesn't satisfy `ArrayBufferView<ArrayBuffer>`
  // because `ArrayBufferLike` includes `SharedArrayBuffer`. WebCrypto
  // accepts both at runtime; the cast asserts the intended subset.
  const cryptoKey = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
      cryptoKey,
      cipherWithTag as BufferSource,
    );
  } catch (cause) {
    // WebCrypto throws an opaque OperationError on auth-tag mismatch.
    // Wrap so callers can show a friendly "decryption failed" message
    // without leaking the implementation-specific error name.
    throw new Error(
      `AES-GCM authentication failed (tampered ciphertext or wrong key)`,
      { cause },
    );
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
}

/**
 * Validate that a client-decrypted SessionLog is consistent with the
 * server-side metadata anchored on AgenticID. Without this check, an
 * encrypted receipt whose anchored `dataDescription` claims sessionId
 * "ses_alpha" but whose decrypted body says "ses_beta" would render
 * as a valid proof — the cryptographic chain is intact, but the
 * IDENTITY chain (token → exec-log:sessionId → blob.sessionId) is not.
 * The plaintext server path already enforces this via SESSION_ID_MISMATCH
 * (verify-proof.ts:378). Codex round-8 caught that the encrypted-mode
 * client path skipped the equivalent check; this helper closes that gap.
 *
 * Returns `null` on success (consistent) or an error message string
 * naming the specific mismatch.
 */
export function checkDecryptedConsistency(
  decrypted: { sessionId?: unknown; entryCount?: unknown; entries?: unknown },
  metadata: { sessionId: string },
): string | null {
  if (typeof decrypted.sessionId !== "string") {
    return "Decrypted payload missing sessionId.";
  }
  if (decrypted.sessionId !== metadata.sessionId) {
    return (
      `sessionId mismatch: server anchored "${metadata.sessionId}" but ` +
      `decrypted body says "${decrypted.sessionId}". Either the wrong ` +
      `key was used or the receipt's storage anchor is inconsistent with ` +
      `its on-chain dataDescription.`
    );
  }
  if (!Array.isArray(decrypted.entries)) {
    return "Decrypted payload missing entries array.";
  }
  if (
    typeof decrypted.entryCount === "number" &&
    decrypted.entryCount !== decrypted.entries.length
  ) {
    return (
      `entryCount mismatch: header says ${String(decrypted.entryCount)} ` +
      `but entries array has ${decrypted.entries.length.toString()}.`
    );
  }
  return null;
}

/**
 * Decode a base64url share-link key string back to raw 32 bytes.
 * Browser-safe (no `Buffer`).
 *
 * base64url uses `-` and `_` instead of `+` and `/`, and may omit
 * padding. We normalize back to base64 before calling `atob`.
 */
export function shareStringToKey(s: string): SessionKey {
  // base64url → base64
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // re-pad to multiple of 4
  while (b64.length % 4 !== 0) b64 += "=";
  let binary: string;
  try {
    binary = atob(b64);
  } catch (cause) {
    throw new Error(
      `Failed to decode base64url key: not valid base64`,
      { cause },
    );
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  if (out.length !== 32) {
    throw new Error(`Decoded key must be 32 bytes; got ${out.length}`);
  }
  return out;
}
