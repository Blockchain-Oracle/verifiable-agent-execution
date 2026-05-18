/**
 * network-config.ts — testnet/mainnet presets + on-disk persistence
 * for the /agentscan_network slash command.
 *
 * Design (v0.4.0):
 *   - Two presets: testnet (Galileo, 16602) and mainnet (Aristotle, 16661).
 *     Every network field — RPC, indexer, contracts, dashboard URL —
 *     comes from `apps/dashboard/src/lib/env.ts` and our Epic-7
 *     deploys, so the plugin and dashboard never disagree on what
 *     mainnet means.
 *   - Presets contain ONLY network-axis fields. Identity-axis fields
 *     (modelId, agentId, privateKeyEnvVar) are NOT here — they're not
 *     network-specific.
 *   - Persistence lives at `~/.agentscan/network.json` (NOT in OpenClaw
 *     config). This keeps the toggle independent of the OpenClaw runtime
 *     and survives plugin upgrades.
 *   - The actual switch requires a gateway restart — silent live-swap of
 *     the chain client mid-session would invalidate in-flight signers and
 *     pending-token claims. The /agentscan_network handler tells the
 *     user explicitly.
 *
 * Hardening (Codex round-1 on v0.4.0):
 *   - Writes are ATOMIC: write to tmp file in the same dir + rename.
 *     A crash mid-write can no longer leave a partial file that
 *     loadPersistedNetwork interprets as missing → silent fallback to
 *     testnet for a mainnet user.
 *   - Loads DISTINGUISH "file missing" (clean state, return null silently)
 *     from "file present but unreadable/corrupt" (log a WARN and return
 *     null — the operator sees something is wrong instead of a silent
 *     network downgrade).
 *   - Path resolution rejects SYMLINKS at both the directory and file
 *     level. Same-user attacks are low severity here (no secret is
 *     written), but a misconfigured symlink could redirect the write to
 *     an arbitrary user-writable target. Use lstat + reject.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type NetworkName = "testnet" | "mainnet";

export interface NetworkPreset {
  rpcUrl: string;
  indexerUrl: string;
  agenticIdAddress: string;
  verifierAddress: string;
  verifyUrlBase: string;
  chainId: number;
  explorerUrl: string;
  faucetUrl?: string;
}

export const NETWORK_PRESETS: Readonly<Record<NetworkName, NetworkPreset>> = Object.freeze({
  testnet: {
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    agenticIdAddress: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
    verifierAddress: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
    verifyUrlBase: "https://agentscan.online",
    chainId: 16602,
    explorerUrl: "https://chainscan-galileo.0g.ai",
    faucetUrl: "https://faucet.0g.ai",
  },
  mainnet: {
    rpcUrl: "https://evmrpc.0g.ai",
    indexerUrl: "https://indexer-storage-turbo.0g.ai",
    agenticIdAddress: "0xC6f7fB1511a7483C6e14258c70529e37ec698937",
    verifierAddress: "0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2",
    verifyUrlBase: "https://mainnet.agentscan.online",
    chainId: 16661,
    explorerUrl: "https://chainscan.0g.ai",
  },
});

/**
 * Resolve the network-config path LAZILY on every call. Capturing
 * `homedir()` at module-load time would lock the path to whatever HOME
 * was when the plugin was first imported, breaking tests that override
 * HOME in beforeEach (the module is cached).
 */
function networkFile(): string {
  return join(homedir(), ".agentscan", "network.json");
}

/**
 * Distinguishable load result so resolveConfig (and the slash-command
 * handler) can choose to LOG a warning when the file exists but is
 * unreadable/corrupt, versus silently using defaults when no file
 * exists at all.
 */
export type LoadNetworkResult =
  | { kind: "ok"; network: NetworkName }
  | { kind: "missing" }
  | { kind: "corrupt"; reason: string }
  | { kind: "symlink" };

/**
 * Detailed load. Use this when you need to know WHY no network was
 * returned (so you can log/warn). Most callers should use the wrapper
 * `loadPersistedNetwork()` below which returns the network-or-null
 * shape that resolveConfig wants.
 */
export function loadPersistedNetworkDetailed(): LoadNetworkResult {
  const file = networkFile();
  if (!existsSync(file)) return { kind: "missing" };
  // Reject symlinks — see WARN-4 in module docstring.
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      return { kind: "symlink" };
    }
    if (!stat.isFile()) {
      return { kind: "corrupt", reason: "path exists but is not a regular file" };
    }
  } catch (cause) {
    return {
      kind: "corrupt",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    return {
      kind: "corrupt",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return {
      kind: "corrupt",
      reason: `JSON parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  // JSON.parse can yield null / arrays / primitives. Guard BEFORE
  // dereferencing — Codex round 2 caught that literal JSON `null` would
  // throw TypeError on `parsed.network` and crash registration.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "corrupt",
      reason: "expected JSON object with `network` field; got " +
        (parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed),
    };
  }
  const network = (parsed as { network?: unknown }).network;
  if (network === "testnet" || network === "mainnet") {
    return { kind: "ok", network };
  }
  return {
    kind: "corrupt",
    reason: `network field missing or invalid (got: ${JSON.stringify(network)})`,
  };
}

/**
 * Backwards-compatible wrapper: returns the persisted network or null.
 * For callers that DON'T need to distinguish "missing" from "corrupt".
 * Existing tests and config.ts use this shape.
 */
export function loadPersistedNetwork(): NetworkName | null {
  const result = loadPersistedNetworkDetailed();
  return result.kind === "ok" ? result.network : null;
}

/**
 * Atomic write: temp file in the same directory, then rename. POSIX
 * rename is atomic within a filesystem, so concurrent readers can never
 * see a partial file. The "in the same directory" matters — cross-FS
 * rename falls back to copy+unlink which is NOT atomic.
 *
 * Directory creation + symlink rejection runs BEFORE the write so a
 * pre-existing symlinked ~/.agentscan/ is caught and refused with a
 * clear error.
 */
export function savePersistedNetwork(network: NetworkName): void {
  const file = networkFile();
  const dir = dirname(file);
  if (existsSync(dir)) {
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink()) {
      throw new Error(
        `refusing to write through symlinked ~/.agentscan (resolve the link first): ${dir}`,
      );
    }
    if (!dirStat.isDirectory()) {
      throw new Error(`~/.agentscan exists but is not a directory: ${dir}`);
    }
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // Reject pre-existing symlinks at the target path too.
  if (existsSync(file)) {
    const fileStat = lstatSync(file);
    if (fileStat.isSymbolicLink()) {
      throw new Error(
        `refusing to write through symlinked network.json (resolve the link first): ${file}`,
      );
    }
  }
  const payload = JSON.stringify(
    { network, updatedAt: new Date().toISOString() },
    null,
    2,
  );
  // Atomic write: tmp file in same dir, then rename. The tmp suffix
  // includes pid + time so two concurrent writes don't collide on the
  // tmp path itself (rename would still be atomic, but tmp collision
  // would surface as ENOENT on the loser).
  const tmpFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpFile, payload, { mode: 0o600 });
    renameSync(tmpFile, file);
  } catch (cause) {
    // Clean up tmp file if rename failed — otherwise we leak.
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      /* best-effort cleanup */
    }
    throw cause;
  }
}

/** Maps a chainId back to its network name, or "unknown" if neither. */
export function chainIdToNetwork(chainId: number): NetworkName | "unknown" {
  if (chainId === 16602) return "testnet";
  if (chainId === 16661) return "mainnet";
  return "unknown";
}
