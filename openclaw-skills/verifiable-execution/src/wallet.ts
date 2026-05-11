/**
 * wallet.ts — auto-managed plugin wallet, xlmtools pattern.
 *
 * The user does NOT have to bring a private key. On first plugin
 * load, we generate a fresh ethers Wallet and persist it to
 * `~/.openclaw/verifiable-execution/wallet.json` (mode 0o600). On
 * subsequent loads we just read the file. The plugin uses the saved
 * wallet to sign 0G Storage uploads + AgenticID iMint transactions.
 *
 * UX (per first-principles audit, 2026-05-06):
 *   - Zero env vars required for the demo path.
 *   - First run prints a friendly stderr message with the wallet
 *     address + faucet URL (https://faucet.0g.ai for testnet, manual
 *     send for mainnet). User claims faucet ONCE — that's the only
 *     setup step.
 *   - Subsequent runs are sync, fast-path: `loadOrCreateWallet()`
 *     reads the JSON.
 *   - PRIVATE_KEY env (if set) overrides the auto-managed wallet —
 *     for production / advanced users. Default is auto-managed.
 *
 * Why per-user wallet (NOT a shared demo wallet):
 *   Discussed + rejected per Abu 2026-05-06. A shared wallet creates
 *   a "trust us to fund it" dependency that breaks down if it drains,
 *   and the same code path needs to work for mainnet (no shared
 *   wallet). One-time faucet claim is acceptable friction; trust-us-
 *   to-fund-it is not.
 *
 * Modeled after xlmtools' `loadOrCreateWallet` / `initWallet`:
 *   github.com/Blockchain-Oracle/xlmtools/packages/cli/src/lib/wallet.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Wallet } from "ethers";

const CONFIG_DIR = join(homedir(), ".openclaw", "verifiable-execution");
const CONFIG_PATH = join(CONFIG_DIR, "wallet.json");

/**
 * On-disk shape. We persist the address alongside the key for
 * diagnostics + so we don't have to derive it on every read.
 */
interface PersistedWallet {
  privateKey: string;
  address: string;
  createdAt: string;
  /** Network the wallet was created for; informational only. */
  network: string;
}

export interface ResolvedWallet {
  privateKey: string;
  address: string;
  /** "auto" (read from disk), "env" (PRIVATE_KEY override), or "fresh" (just created). */
  source: "auto" | "env" | "fresh";
}

/**
 * Resolve the plugin's signing wallet. Three sources, checked in order:
 *
 *   1. process.env[envVarName]  → highest priority (advanced override)
 *      Default envVarName is "PRIVATE_KEY"; the plugin's
 *      `config.privateKeyEnvVar` can override it so operators with
 *      multiple agents on one host can keep their keys in different
 *      env vars (e.g. PRIVATE_KEY_AGENT_A, PRIVATE_KEY_AGENT_B).
 *   2. ~/.openclaw/verifiable-execution/wallet.json  → auto-managed
 *   3. Generate a fresh wallet  → first-run path
 *
 * Returns synchronously — no network calls. Funding is the user's
 * responsibility (we surface the faucet URL on first-run).
 */
export function resolveWallet(opts?: { envVarName?: string }): ResolvedWallet {
  // 1. Env override — read from the configured env-var name, defaulting
  //    to PRIVATE_KEY. (Codex P2 on PR #23: prior version always read
  //    process.env.PRIVATE_KEY directly and silently ignored
  //    config.privateKeyEnvVar, regressing the documented schema
  //    semantics.)
  const envVarName = opts?.envVarName ?? "PRIVATE_KEY";
  const envKey = process.env[envVarName];
  if (typeof envKey === "string" && envKey.length > 0) {
    const w = new Wallet(envKey);
    return { privateKey: envKey, address: w.address, source: "env" };
  }

  // 2. Disk fast-path
  if (existsSync(CONFIG_PATH)) {
    // If the file EXISTS but is unreadable/malformed, FAIL LOUDLY
    // instead of silently regenerating. Silent regen would orphan a
    // previously-funded wallet — the operator wouldn't know their
    // session identity changed, and the new wallet would have no
    // funds to mint with. (Codex bot round-10 P1 on PR #23.)
    //
    // Recovery: deliberately delete or move the file aside and re-run
    // (which falls through to fresh-gen below), or restore from a
    // backup if the wallet was funded.
    let raw: string;
    try {
      raw = readFileSync(CONFIG_PATH, "utf8");
    } catch (cause) {
      throw new Error(
        `Wallet file at ${CONFIG_PATH} exists but is unreadable: ` +
          `${(cause as Error).message ?? String(cause)}. ` +
          `Refusing to regenerate silently — that would orphan any ` +
          `funded keypair. Move/delete the file deliberately to force ` +
          `fresh generation, or restore from backup.`,
      );
    }
    let persisted: PersistedWallet;
    try {
      persisted = JSON.parse(raw) as PersistedWallet;
    } catch (cause) {
      throw new Error(
        `Wallet file at ${CONFIG_PATH} is not valid JSON: ` +
          `${(cause as Error).message ?? String(cause)}. ` +
          `Refusing to regenerate silently — that would orphan any ` +
          `funded keypair. Move/delete the file deliberately to force ` +
          `fresh generation, or restore from backup.`,
      );
    }
    if (typeof persisted.privateKey !== "string" || persisted.privateKey.length === 0) {
      throw new Error(
        `Wallet file at ${CONFIG_PATH} is missing a valid privateKey ` +
          `field. Refusing to regenerate silently — that would orphan ` +
          `any funded keypair. Move/delete the file deliberately to ` +
          `force fresh generation, or restore from backup.`,
      );
    }
    return {
      privateKey: persisted.privateKey,
      address: persisted.address ?? new Wallet(persisted.privateKey).address,
      source: "auto",
    };
  }

  // 3. Fresh generation + persist
  const fresh = Wallet.createRandom();
  const persisted: PersistedWallet = {
    privateKey: fresh.privateKey,
    address: fresh.address,
    createdAt: new Date().toISOString(),
    network: "0g-galileo-testnet",
  };
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(persisted, null, 2)}\n`, {
    mode: 0o600,
  });
  return { privateKey: fresh.privateKey, address: fresh.address, source: "fresh" };
}

/**
 * Print the first-run setup banner to stderr. Called by register()
 * AFTER resolveWallet() returns source==="fresh". Never throws —
 * stderr write failures are swallowed so a TTY hiccup can't crash
 * the plugin host.
 */
export function printFirstRunBanner(wallet: ResolvedWallet): void {
  if (wallet.source !== "fresh") return;
  const lines = [
    "",
    "═══════════════════════════════════════════════════════════════",
    "  Verifiable Execution — First Run Setup",
    "═══════════════════════════════════════════════════════════════",
    "",
    `  Wallet:    ${wallet.address}`,
    "  Saved to:  ~/.openclaw/verifiable-execution/wallet.json",
    "  Network:   0G Galileo testnet (chainId 16602)",
    "",
    "  Fund this wallet ONCE so the plugin can mint proofs:",
    "",
    `    1. Visit https://faucet.0g.ai`,
    `    2. Paste:  ${wallet.address}`,
    "    3. Claim 0.1 0G (free, daily limit)",
    "",
    "  After funding, every OpenClaw session will auto-anchor and",
    "  print a /verify/<tokenId> URL.",
    "",
    "═══════════════════════════════════════════════════════════════",
    "",
  ];
  try {
    process.stderr.write(lines.join("\n"));
  } catch {
    // Stderr write failures must never crash the plugin host.
  }
}
