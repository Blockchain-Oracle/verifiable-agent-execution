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
    const path = join(this.pendingDir, this.sanitizeFilename(sessionKey) + ".key");
    this.atomicWriteBytes(path, key);
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
    const pendingPath = join(
      this.pendingDir,
      this.sanitizeFilename(sessionKey) + ".key",
    );
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
   * "/my-receipts" command and by ops tooling.
   */
  list(): string[] {
    if (!existsSync(this.committedDir)) return [];
    return readdirSync(this.committedDir)
      .filter((f) => f.endsWith(".key"))
      .map((f) => f.slice(0, -4));
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
   * Sanitize a sessionKey or tokenId for use as a filename. OpenClaw
   * sessionKeys can contain `:` and `/` (e.g. "agent:core:telegram:direct:8028…")
   * — both of those break filename rules. Replace with `_`. The mapping
   * is one-way; if two distinct sessionKeys collide post-sanitize, the
   * second write wins (rare and acceptable — the temp file is only
   * alive between flush and mint).
   */
  private sanitizeFilename(name: string): string {
    return name.replace(/[/\\:?"<>|*]/g, "_").replace(/^\.+/, "_");
  }
}
