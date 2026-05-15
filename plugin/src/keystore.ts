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
  /**
   * Optional run identifier (v0.3.4). When the receipt was minted under
   * the "one agent task = one token" anchor flow, this carries the
   * `event.runId` (or synthetic `anon-<hex>` fallback) so the operator
   * can correlate the share URL back to a specific agent run.
   *
   * Optional for backwards-compat: pre-v0.3.4 pointers do not include
   * runId and `getLast()` still returns them. Treat missing as "unknown
   * run" rather than a parse failure.
   */
  runId?: string;
  mintedAt: number; // unix seconds
}

/**
 * Sidecar metadata written next to each pending key file. The
 * filesystem identity is the (base64url-encoded) `pendingKeyName`
 * which since v0.3.4 is the COMPOUND `${sessionKey}|run:${runId}` —
 * but operators want to see the BARE `sessionKey` + `runId` for
 * recovery + audit, not the compound. The sidecar carries both
 * fields so `listPending()` can surface the originals without the
 * caller having to split the compound key themselves.
 *
 * Backwards-compat: pre-v0.3.4 sidecars carry only `sessionKey` and
 * no `runId`. The reader treats missing `runId` as null + still
 * returns the entry so recovery tooling can finish committing legacy
 * pending keys without crashing.
 */
interface PendingMetadata {
  sessionKey: string;
  /** Optional — v0.3.4 introduced this; pre-v0.3.4 sidecars omit it. */
  runId?: string;
  createdAt: number; // unix seconds
}

/**
 * Optional metadata bag passed to `setPending` + `commitPending` (v0.3.4).
 * Decouples the filesystem identity (`pendingKeyName`) from the
 * user-visible `sessionKey` + `runId` so the compound form never leaks
 * into `last-receipt.json` or `listPending()` output.
 *
 * When omitted, the legacy single-arg pattern still works: callers
 * pass the bare `sessionKey` as `pendingKeyName` and the sidecar
 * records that string as both filesystem identity and metadata
 * sessionKey. Keeps pre-v0.3.4 callers compiling.
 */
export interface PendingMetadataInput {
  sessionKey: string;
  runId?: string;
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
   * Persist a key BEFORE mint, indexed by `pendingKeyName`. If the
   * plugin crashes between this call and `commitPending`, K survives
   * on disk so a retry can recover the rootHash association.
   *
   * v0.3.4: `pendingKeyName` is the FILESYSTEM identity (typically the
   * compound `${sessionKey}|run:${runId}` for the "one agent task =
   * one token" flow). The optional `meta` bag carries the BARE
   * `sessionKey` + `runId` so the sidecar records them separately and
   * `listPending()` can surface the originals — never the compound.
   *
   * When `meta` is omitted, the function falls back to the legacy
   * v0.3.0 behavior: `pendingKeyName` IS the sessionKey, sidecar
   * records it as such, no `runId`. Keeps pre-v0.3.4 callers green
   * through the transition window.
   */
  setPending(
    pendingKeyName: string,
    key: Buffer,
    meta?: PendingMetadataInput,
  ): void {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes; got ${key.length}`);
    }
    this.ensureDirs();
    const sanitized = this.sanitizeFilename(pendingKeyName);
    const keyPath = join(this.pendingDir, sanitized + ".key");
    this.atomicWriteBytes(keyPath, key);
    // Sidecar carries the operator-visible sessionKey + runId, not
    // the compound pendingKeyName. listPending() reads this back so
    // recovery tooling sees the bare sessionKey + a distinct runId
    // field, never the `${sessionKey}|run:${runId}` mash.
    const metaPath = join(this.pendingDir, sanitized + ".meta.json");
    const sidecar: PendingMetadata = {
      sessionKey: meta?.sessionKey ?? pendingKeyName,
      ...(meta?.runId !== undefined ? { runId: meta.runId } : {}),
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.atomicWriteText(metaPath, JSON.stringify(sidecar));
  }

  /**
   * Promote a pending key (indexed by `pendingKeyName`) to a committed
   * key (indexed by tokenId). Also updates `last-receipt.json` so a
   * subsequent `/share` with no args targets this token.
   *
   * v0.3.4: `pendingKeyName` is the FILESYSTEM identity (typically the
   * compound `${sessionKey}|run:${runId}`). The optional `meta` bag
   * carries the BARE `sessionKey` + `runId` that get written into
   * `last-receipt.json` so the no-args `/share` footnote renders the
   * original sessionKey, not the compound. When `meta` is omitted,
   * the function falls back to legacy v0.3.0 behavior (treating
   * `pendingKeyName` as the user-visible sessionKey).
   *
   * Returns true if a pending key was found + promoted, false if no
   * pending key existed for that pendingKeyName (e.g., the operator
   * manually called `put(tokenId, key)` and is now linking it).
   */
  commitPending(
    pendingKeyName: string,
    tokenId: string,
    meta?: PendingMetadataInput,
  ): boolean {
    this.ensureDirs();
    const sanitized = this.sanitizeFilename(pendingKeyName);
    const pendingPath = join(this.pendingDir, sanitized + ".key");
    const pendingMetaPath = join(this.pendingDir, sanitized + ".meta.json");
    const committedPath = join(
      this.committedDir,
      this.committedFilename(tokenId) + ".key",
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
    // last-receipt.json gets the BARE sessionKey + runId (NOT the
    // compound pendingKeyName). This is what the no-args `/share`
    // command surfaces in the footnote — operators need the original
    // sessionKey to correlate with their agent runtime, not our
    // internal compound identifier.
    this.writeLastReceiptPointer({
      tokenId,
      sessionKey: meta?.sessionKey ?? pendingKeyName,
      ...(meta?.runId !== undefined ? { runId: meta.runId } : {}),
      mintedAt: Math.floor(Date.now() / 1000),
    });
    return true;
  }

  /**
   * Direct put — for retry paths or manual association.
   *
   * Also updates `last-receipt.json` so that `/share` with no args
   * returns this tokenId (parity with the setPending → commitPending
   * production flow which also updates the pointer).
   *
   * v0.3.4: accepts an optional `meta` bag so callers from the
   * commitPending-fallback path (where the AES key was generated
   * inside an `agent_end` and we know its `sessionKey` + `runId`)
   * can preserve the metadata contract — `last-receipt.json` ends up
   * with the BARE sessionKey + runId, not the `direct-put:<tokenId>`
   * synthetic marker. When `meta` is omitted (genuinely-direct calls
   * with no agent-runtime context), the synthetic marker still
   * applies so share-command can tell apart "minted via direct-put"
   * vs. "minted via agent_end."
   */
  put(tokenId: string, key: Buffer, meta?: PendingMetadataInput): void {
    if (key.length !== 32) {
      throw new Error(`Key must be 32 bytes; got ${key.length}`);
    }
    this.ensureDirs();
    const path = join(
      this.committedDir,
      this.committedFilename(tokenId) + ".key",
    );
    this.atomicWriteBytes(path, key);
    this.writeLastReceiptPointer({
      tokenId,
      sessionKey: meta?.sessionKey ?? `direct-put:${tokenId}`,
      ...(meta?.runId !== undefined ? { runId: meta.runId } : {}),
      mintedAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Look up a key by tokenId. Returns null if missing — callers (the
   * /share handler) MUST handle this and reply "key not found on this
   * host" rather than throwing back into the chat.
   */
  get(tokenId: string): Buffer | null {
    // Lenient read: if the tokenId isn't a valid decimal string,
    // we know we never wrote a file for it (committedFilename
    // validates on write). Return null instead of throwing so
    // callers like /share don't crash on user-supplied junk.
    if (!/^[0-9]+$/.test(tokenId)) return null;
    const path = join(this.committedDir, tokenId + ".key");
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
   *
   * v0.3.4 pointers include an optional `runId`; pre-v0.3.4 pointers
   * omit it. Either is returned successfully — the consumer (`/share`
   * footnote) treats missing runId as "unknown run."
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
      const pointer: LastReceiptPointer = {
        tokenId: parsed.tokenId,
        sessionKey: parsed.sessionKey,
        mintedAt: parsed.mintedAt,
        ...(typeof parsed.runId === "string" ? { runId: parsed.runId } : {}),
      };
      return pointer;
    } catch {
      // Pointer corrupt or unreadable — treat as missing rather than
      // crash the share handler. Operator can manually grep for the
      // most recent token via `ls -t keystore/`.
      return null;
    }
  }

  /**
   * List all tokenIds with committed keys. Used by the (post-hackathon)
   * "/my-receipts" command and by ops tooling. Committed key files
   * are stored at the literal path `<tokenId>.key` (Codex round-18
   * fix — tokenIds are stringified BigInts with no special chars,
   * so no encoding is needed). The `[0-9]+` validation in
   * committedFilename() means we can safely return these filenames
   * directly as tokenIds.
   */
  list(): string[] {
    if (!existsSync(this.committedDir)) return [];
    return readdirSync(this.committedDir)
      .filter((f) => f.endsWith(".key"))
      .map((f) => f.slice(0, -4))
      // Defensive filter: ignore stray files that don't match the
      // tokenId shape (e.g. leftover .tmp files from atomicWriteBytes
      // crashes, or legacy base64url-encoded names from a pre-r18
      // install — operators with such legacy files can `ls keystore/`
      // manually).
      .filter((name) => /^[0-9]+$/.test(name));
  }

  /**
   * List pending keys awaiting commit. v0.3.4: returns the BARE
   * `sessionKey` and a separate `runId` field (NOT the compound
   * `pendingKeyName` filesystem identity). Recovery tooling uses
   * these originals to call `commitPending(pendingKeyName, tokenId,
   * {sessionKey, runId})` once it learns the minted tokenId.
   *
   * Resolution order for `sessionKey` + `runId`:
   *   1. Sidecar `.meta.json` written by setPending (v0.3.4) — has
   *      both fields cleanly separated. Preferred.
   *   2. Sidecar `.meta.json` written by pre-v0.3.4 setPending — only
   *      has `sessionKey`; `runId` returns null. Still recoverable.
   *   3. No sidecar, decoded filename — fallback to filename as
   *      `sessionKey`, `runId` null. Rare: only happens when the
   *      sidecar write failed but the .key landed.
   *   4. No sidecar, undecodable filename — `sessionKey` null,
   *      `runId` null. Operator sees the orphan via
   *      `sanitizedFilename` and decides manually.
   */
  listPending(): Array<{
    sessionKey: string | null;
    /** v0.3.4 run identifier; null when the sidecar predates v0.3.4 or is missing. */
    runId: string | null;
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
      const metaPath = join(this.pendingDir, sanitizedFilename + ".meta.json");
      // Primary path: sidecar present. v0.3.4 sidecars carry BOTH
      // sessionKey + runId; v0.3.0–v0.3.3 sidecars carry only
      // sessionKey (runId is then surfaced as null).
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(
            readFileSync(metaPath, "utf8"),
          ) as Partial<PendingMetadata>;
          return {
            sessionKey:
              typeof meta.sessionKey === "string" ? meta.sessionKey : null,
            runId: typeof meta.runId === "string" ? meta.runId : null,
            sanitizedFilename,
            createdAt:
              typeof meta.createdAt === "number" ? meta.createdAt : null,
          };
        } catch {
          // Sidecar corrupt — fall through to filename-decode fallback.
        }
      }
      // Fallback: try to recover sessionKey from the base64url filename
      // (the pendingKeyName at write time). For v0.3.4 callers this is
      // the COMPOUND `${sessionKey}|run:${runId}` form — without the
      // sidecar we can't safely split it apart (sessionKey itself may
      // contain `|`), so we leave runId null and surface the compound
      // as sessionKey so the operator can split it manually. For
      // pre-v0.3.4 callers the decoded filename IS the sessionKey.
      const fromFilename = this.decodeFilename(sanitizedFilename);
      return {
        sessionKey: fromFilename,
        runId: null,
        sanitizedFilename,
        createdAt: null,
      };
    });
  }

  /**
   * Remove a key from the keystore. No "revoke" semantics — the key
   * is already shared if anyone has the URL; this only stops the
   * local /share command from re-emitting it.
   */
  remove(tokenId: string): void {
    // Lenient: a remove on an invalid tokenId is a no-op (we never
    // wrote a file for it). Don't throw — operator tools may pass
    // arbitrary strings.
    if (!/^[0-9]+$/.test(tokenId)) return;
    const path = join(this.committedDir, tokenId + ".key");
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
   * Encode a sessionKey for use as a pending-file filename. OpenClaw
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
   * **Scope (Codex round-18 fix):** this encoding is for SESSION KEYS
   * only — i.e. the pending/ directory. Committed token-id key files
   * (`keystore/<tokenId>.key`) use the LITERAL tokenId because tokenIds
   * are stringified BigInts (digits only), which can't collide and
   * which the BDD spec requires to live at the human-readable path.
   * See `committedFilename` for the tokenId path.
   */
  private encodeFilename(name: string): string {
    return Buffer.from(name, "utf8").toString("base64url");
  }

  /**
   * Filename for a committed token-id key file. The BDD spec
   * requires the literal path `keystore/<tokenId>.key` (see
   * story-v0.3.0-private-receipts.md). TokenIDs in our flow are
   * always BigInt → decimal string, so the path is collision-free
   * by construction. For defense in depth, we still validate: only
   * `[0-9]+` token IDs are accepted; anything else throws (would
   * indicate a caller bug or a malicious input upstream).
   */
  private committedFilename(tokenId: string): string {
    if (!/^[0-9]+$/.test(tokenId)) {
      throw new Error(
        `tokenId must be a non-empty decimal string; got "${tokenId}". ` +
          `If you need to bind a non-decimal identifier, encode it upstream ` +
          `before calling put()/commitPending()/get().`,
      );
    }
    return tokenId;
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
