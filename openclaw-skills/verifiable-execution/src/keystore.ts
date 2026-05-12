/**
 * keystore.ts — per-tokenId encryption key persistence + last-receipt pointer.
 *
 * Layout under `~/.openclaw/verifiable-execution/`:
 *   wallet.json                          — the plugin's signing key (existing)
 *   keystore/<tokenId>.key               — raw 32-byte symmetric key per receipt (mode 0600)
 *   keystore/pending/<sessionKey>.key    — pre-mint key (crash recovery — see ordering below)
 *   keystore/last-receipt.json           — {tokenId, sessionKey, mintedAt} pointer for `/share`
 *                                          with no args ("share my most recent receipt")
 *
 * Crash-recovery ordering (CRITICAL — derived from research agent 2's risk #8):
 *
 *   1. plugin generates K  (in memory)
 *   2. keystore.setPending(sessionKey, K)        ← BEFORE flush. If we crash here,
 *                                                   K is on disk under the SESSION key.
 *   3. SessionLogger.flush()                     → 0G Storage rootHash
 *   4. AgenticIDClient.iMint(rootHash)           → tokenId
 *   5. keystore.commitPending(sessionKey, tokenId)
 *                                                ← AFTER mint. Renames pending/<sessionKey>.key
 *                                                   to <tokenId>.key + updates last-receipt.json
 *
 *   If the plugin crashes between flush and mint: K is still under
 *   pending/<sessionKey>.key. Operator runs `retryMint` (existing primitive in
 *   SessionAnchorMintAfterFlushError recovery) which produces the same tokenId,
 *   then manually calls commitPending. Without this ordering, a crash between
 *   flush and mint would lose K forever, making the rootHash unrecoverable.
 *
 * Why files-on-disk instead of a real DB?
 *   - The wallet.json precedent is the same pattern. Operators back up
 *     ~/.openclaw/verifiable-execution/ as one directory; keystore rides along.
 *   - No new daemon, no migration, no schema. mkdir + writeFile + readFile.
 *   - Atomicity: we write to a `.tmp` and rename — POSIX-atomic on the same
 *     filesystem. Good enough for hackathon-grade persistence.
 *
 * Why NOT encrypt the keystore-at-rest?
 *   - We could wrap each K with the operator's wallet pubkey (ECIES) for
 *     defense-in-depth. Deferred to v0.4 — for now, the keystore lives under
 *     mode-0700 dir + mode-0600 files, same as wallet.json. If the host is
 *     compromised at FS level, the wallet's private key is ALSO leaked and
 *     the operator has bigger problems than receipt decryption.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Default keystore root, sibling to wallet.json. Override via env
 * VERIFIABLE_EXECUTION_KEYSTORE_DIR for tests / containerized installs.
 */
const DEFAULT_ROOT = join(homedir(), ".openclaw", "verifiable-execution");

export interface LastReceiptPointer {
  tokenId: string;
  sessionKey: string;
  mintedAt: number; // unix seconds
}

/**
 * Sidecar metadata written next to each pending key file so the
 * ORIGINAL sessionKey (with separators intact) survives the
 * one-way sanitization that goes into the filename. Used by
 * `listPending()` to give crash-recovery tooling a copy-paste
 * sessionKey for `commitPending(sessionKey, tokenId)`.
 */
interface PendingMetadata {
  sessionKey: string;
  createdAt: number; // unix seconds
}

export class Keystore {
  private readonly root: string;
  private readonly committedDir: string;
  private readonly pendingDir: string;
  private readonly lastReceiptPath: string;

  constructor(opts?: { root?: string }) {
    this.root = opts?.root ?? DEFAULT_ROOT;
    this.committedDir = join(this.root, "keystore");
    this.pendingDir = join(this.committedDir, "pending");
    this.lastReceiptPath = join(this.committedDir, "last-receipt.json");
    this.ensureDirs();
  }

  /** Idempotent — creates the keystore dirs with restrictive permissions. */
  private ensureDirs(): void {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(this.committedDir)) {
      mkdirSync(this.committedDir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(this.pendingDir)) {
      mkdirSync(this.pendingDir, { recursive: true, mode: 0o700 });
    }
    // chmod is idempotent — re-tighten if a tool relaxed perms.
    try {
      chmodSync(this.root, 0o700);
      chmodSync(this.committedDir, 0o700);
      chmodSync(this.pendingDir, 0o700);
    } catch {
      // Best-effort; on Windows chmod may fail and that's fine.
    }
  }

  /**
   * Persist a key BEFORE mint, indexed by sessionKey. If the plugin
   * crashes between this call and `commitPending`, K survives on disk
   * so a retry can recover the rootHash association.
   *
   * sessionKey is whatever the plugin uses to identify the session
   * (OpenClaw's `ctx.sessionKey` or `ctx.sessionId`); we sanitize for
   * filesystem safety.
   */
  setPending(sessionKey: string, key: Buffer): void {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes; got ${key.length}`);
    }
    this.ensureDirs();
    const sanitized = this.sanitizeFilename(sessionKey);
    const keyPath = join(this.pendingDir, sanitized + ".key");
    this.atomicWriteBytes(keyPath, key);
    // Sidecar metadata preserves the ORIGINAL sessionKey (sanitization
    // is one-way: ":"/"/" all collapse to "_", so we cannot recover
    // the agent-runtime sessionKey from the filename alone). After a
    // crash, listPending() reads these sidecars to give operators a
    // copy-paste-ready sessionKey for retryMint(sessionKey, tokenId).
    const metaPath = join(this.pendingDir, sanitized + ".meta.json");
    const meta: PendingMetadata = {
      sessionKey,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.atomicWriteText(metaPath, JSON.stringify(meta));
  }

  /**
   * Promote a pending key (indexed by sessionKey) to a committed key
   * (indexed by tokenId). Also updates `last-receipt.json` so a
   * subsequent `/share` with no args targets this token.
   *
   * Returns true if a pending key was found + promoted, false if no
   * pending key existed for that sessionKey (e.g., the operator
   * manually called `put(tokenId, key)` and is now linking it).
   */
  commitPending(sessionKey: string, tokenId: string): boolean {
    this.ensureDirs();
    const sanitized = this.sanitizeFilename(sessionKey);
    const pendingPath = join(this.pendingDir, sanitized + ".key");
    const pendingMetaPath = join(this.pendingDir, sanitized + ".meta.json");
    const committedPath = join(
      this.committedDir,
      this.sanitizeFilename(tokenId) + ".key",
    );
    if (!existsSync(pendingPath)) return false;
    renameSync(pendingPath, committedPath);
    try {
      chmodSync(committedPath, 0o600);
    } catch {
      // best-effort
    }
    // Sidecar cleanup. Best-effort: if the .meta.json is missing
    // (e.g., the operator manually placed a .key file), don't fail
    // the commit — the .key is the load-bearing artifact, the sidecar
    // is operator-comfort metadata.
    if (existsSync(pendingMetaPath)) {
      try {
        unlinkSync(pendingMetaPath);
      } catch {
        // best-effort
      }
    }
    this.writeLastReceiptPointer({
      tokenId,
      sessionKey,
      mintedAt: Math.floor(Date.now() / 1000),
    });
    return true;
  }

  /**
   * Direct put — for retry paths or manual association.
   *
   * Also updates `last-receipt.json` so that `/share` with no args
   * returns this tokenId (parity with the setPending → commitPending
   * production flow which also updates the pointer). The sessionKey
   * field is filled with a synthetic `direct-put:<tokenId>` marker
   * because `put` is called outside the agent runtime and doesn't
   * have a real OpenClaw session identifier — share-command renders
   * the marker in the session footnote so operators can tell apart
   * "minted via /share" vs. "minted via agent_end."
   */
  put(tokenId: string, key: Buffer): void {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes; got ${key.length}`);
    }
    this.ensureDirs();
    const path = join(
      this.committedDir,
      this.sanitizeFilename(tokenId) + ".key",
    );
    this.atomicWriteBytes(path, key);
    this.writeLastReceiptPointer({
      tokenId,
      sessionKey: `direct-put:${tokenId}`,
      mintedAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Look up a key by tokenId. Returns null if missing — callers (the
   * /share handler) MUST handle this and reply "key not found on this
   * host" rather than throwing back into the chat.
   */
  get(tokenId: string): Buffer | null {
    const path = join(
      this.committedDir,
      this.sanitizeFilename(tokenId) + ".key",
    );
    if (!existsSync(path)) return null;
    const buf = readFileSync(path);
    if (buf.length !== 32) {
      throw new Error(
        `Corrupt key file at ${path}: expected 32 bytes, got ${buf.length}`,
      );
    }
    return buf;
  }

  /**
   * Return the last-receipt pointer for `/share` with no arguments.
   * null when no receipts have been minted yet on this host.
   */
  getLast(): LastReceiptPointer | null {
    if (!existsSync(this.lastReceiptPath)) return null;
    try {
      const raw = readFileSync(this.lastReceiptPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LastReceiptPointer>;
      if (
        typeof parsed.tokenId !== "string" ||
        typeof parsed.sessionKey !== "string" ||
        typeof parsed.mintedAt !== "number"
      ) {
        return null;
      }
      return parsed as LastReceiptPointer;
    } catch {
      // Pointer corrupt or unreadable — treat as missing rather than
      // crash the share handler. Operator can manually grep for the
      // most recent token via `ls -t keystore/`.
      return null;
    }
  }

  /**
   * List all tokenIds with committed keys. Used by the (post-hackathon)
   * "/my-receipts" command and by ops tooling. Filenames are
   * base64url-encoded (Codex round-14 fix) — decode back to the
   * original tokenId string.
   */
  list(): string[] {
    if (!existsSync(this.committedDir)) return [];
    const out: string[] = [];
    for (const f of readdirSync(this.committedDir)) {
      if (!f.endsWith(".key")) continue;
      const encoded = f.slice(0, -4);
      const decoded = this.decodeFilename(encoded);
      if (decoded !== null) out.push(decoded);
    }
    return out;
  }

  /**
   * List pending keys awaiting commit, with their ORIGINAL sessionKey
   * (not the sanitized filename). Used by crash-recovery tooling:
   * after a process restart, the operator runs `listPending()` to
   * discover sessions that flushed encrypted bytes to 0G Storage but
   * never finished mint, and re-issues `commitPending(sessionKey,
   * tokenId)` once they learn the eventually-minted tokenId.
   *
   * Returns entries whose .key file is intact. A pending .key without
   * a matching sidecar surfaces with sessionKey === null so the
   * operator can still see the orphan (rare — only happens if the
   * sidecar write succeeded but the .meta.json write didn't, or vice
   * versa, or someone manually placed a .key file).
   */
  listPending(): Array<{
    sessionKey: string | null;
    /** Filename minus ".key" extension — the sanitized form on disk. */
    sanitizedFilename: string;
    /** Unix seconds; null when the sidecar is missing. */
    createdAt: number | null;
  }> {
    if (!existsSync(this.pendingDir)) return [];
    const keyFiles = readdirSync(this.pendingDir).filter((f) =>
      f.endsWith(".key"),
    );
    return keyFiles.map((keyFile) => {
      const sanitizedFilename = keyFile.slice(0, -4);
      // Primary recovery: base64url-decode the filename (Codex round-14
      // fix). The filename now IS the original sessionKey, just encoded,
      // so we don't need the .meta.json sidecar to reverse it.
      const fromFilename = this.decodeFilename(sanitizedFilename);
      if (fromFilename !== null) {
        const metaPath = join(this.pendingDir, sanitizedFilename + ".meta.json");
        let createdAt: number | null = null;
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(
              readFileSync(metaPath, "utf8"),
            ) as Partial<PendingMetadata>;
            createdAt =
              typeof meta.createdAt === "number" ? meta.createdAt : null;
          } catch {
            // Sidecar corrupt — recover sessionKey from filename anyway.
          }
        }
        return { sessionKey: fromFilename, sanitizedFilename, createdAt };
      }
      // Legacy fallback: a .key file written by older pre-round-14 code
      // would have a sanitized (non-base64url) filename. Read the
      // sidecar for the original sessionKey. Decommissioned once all
      // legacy pending entries have been committed or wiped.
      const metaPath = join(this.pendingDir, sanitizedFilename + ".meta.json");
      if (!existsSync(metaPath)) {
        return { sessionKey: null, sanitizedFilename, createdAt: null };
      }
      try {
        const meta = JSON.parse(
          readFileSync(metaPath, "utf8"),
        ) as Partial<PendingMetadata>;
        return {
          sessionKey:
            typeof meta.sessionKey === "string" ? meta.sessionKey : null,
          sanitizedFilename,
          createdAt:
            typeof meta.createdAt === "number" ? meta.createdAt : null,
        };
      } catch {
        return { sessionKey: null, sanitizedFilename, createdAt: null };
      }
    });
  }

  /**
   * Remove a key from the keystore. No "revoke" semantics — the key
   * is already shared if anyone has the URL; this only stops the
   * local /share command from re-emitting it.
   */
  remove(tokenId: string): void {
    const path = join(
      this.committedDir,
      this.sanitizeFilename(tokenId) + ".key",
    );
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  private writeLastReceiptPointer(ptr: LastReceiptPointer): void {
    this.atomicWriteText(this.lastReceiptPath, JSON.stringify(ptr) + "\n");
  }

  /**
   * Atomic-ish: write to .tmp then rename. POSIX-atomic on same FS.
   * On Windows the rename may not be atomic; accepted for hackathon.
   */
  private atomicWriteBytes(target: string, bytes: Buffer): void {
    const tmp = target + ".tmp";
    const dir = dirname(target);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      // best-effort
    }
  }

  private atomicWriteText(target: string, text: string): void {
    const tmp = target + ".tmp";
    const dir = dirname(target);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(tmp, text, { mode: 0o600, encoding: "utf8" });
    renameSync(tmp, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      // best-effort
    }
  }

  /**
   * Encode a sessionKey or tokenId for use as a filename. OpenClaw
   * sessionKeys can contain `:` and `/` (e.g.
   * "agent:core:telegram:direct:8028..."). Earlier revisions did a
   * lossy `/[/:?...]/g → "_"` substitution, but Codex round-14 caught
   * the resulting collision: `a:b` and `a/b` BOTH sanitized to `a_b`,
   * letting a later setPending overwrite an earlier pending key file.
   * `commitPending(sessionKey, tokenId)` could then bind the WRONG
   * AES key to the wrong tokenId — a real cross-session leak (the
   * resulting `/share <tokenId>` URL would emit a key that decrypts a
   * DIFFERENT session's content). Severity: high.
   *
   * Fix: base64url-encode the full string. Reversible (decodeFilename),
   * collision-free (the bytes are injective into base64url), and short
   * enough for filesystem name limits (~250 bytes typical, ~33%
   * overhead — even a 100-char OpenClaw sessionKey fits comfortably).
   * Note: base64url uses `A-Za-z0-9_-` plus optional `=` padding, all
   * filesystem-safe; we strip padding so the filename has no `=`.
   *
   * Token IDs are always stringified integers in our flow (BigInt →
   * decimal string), which encode to ASCII-equivalent base64url that's
   * 33% longer (e.g. "42" → "NDI"). That's a slight cosmetic regression
   * in `ls keystore/` output but the security gain dominates.
   */
  private encodeFilename(name: string): string {
    return Buffer.from(name, "utf8").toString("base64url");
  }

  /**
   * Inverse of encodeFilename. Returns null on malformed input so a
   * stray file in the pending/ dir (not produced by us) can't crash
   * listPending().
   */
  private decodeFilename(encoded: string): string | null {
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      // Round-trip check: re-encoding must produce the original
      // filename. base64url is permissive about padding which would
      // otherwise let multiple encodings decode the same way.
      if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Backwards-compat alias used by older call sites within this file.
   * All callers now route through encodeFilename, but the old method
   * name is preserved for line-noise compatibility with the rest of
   * the class until the refactor settles. (This is a one-line delegate;
   * future cleanup can inline it.)
   */
  private sanitizeFilename(name: string): string {
    return this.encodeFilename(name);
  }
}
