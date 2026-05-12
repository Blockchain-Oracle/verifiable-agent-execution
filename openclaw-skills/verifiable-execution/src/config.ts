/**
 * config.ts — resolve the plugin's runtime settings, falling back to
 * Galileo testnet defaults so the plugin can be installed without any
 * pre-existing config block.
 *
 * Design:
 *   The configSchema declares NO required fields (changed in 0.1.1) so
 *   `openclaw plugins install <pkg>` succeeds even with an empty
 *   `plugins.entries.verifiable-execution.config` block. resolveConfig
 *   then fills the empty fields with Galileo defaults — true zero-config
 *   end-user experience.
 *
 * What stays validated:
 *   - Address fields, IF provided, must look like 0x-prefixed 20-byte hex
 *     (otherwise `{ ok: false, invalid: [...] }` and the plugin enters
 *     degraded mode). A bad-looking override deserves a loud warning,
 *     not silent default-substitution.
 *   - chainId, IF provided, must be a positive integer.
 *   - agentId is intentionally NOT defaulted here — the plugin entry
 *     fills it from the auto-generated wallet's address after wallet
 *     resolution. Leaving the default empty here keeps the wallet the
 *     single source of truth for "who signed this proof".
 */

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

// ---------------------------------------------------------------------------
// Galileo testnet defaults — match `apps/dashboard/src/lib/env.ts` and our
// Epic-7 deployed contracts. Operators wanting mainnet (Aristotle) override
// every field; there's no auto-switch (silent network swap would be worse
// than a one-time config edit).
// ---------------------------------------------------------------------------

export const GALILEO_TESTNET_DEFAULTS = Object.freeze({
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  agenticIdAddress: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
  verifierAddress: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
  verifyUrlBase: "https://verifiable.0g.ai",
  chainId: 16602,
  modelId: "claude-sonnet-4-6",
} as const);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface VerifiableExecutionConfig {
  rpcUrl: string;
  indexerUrl: string;
  agenticIdAddress: string;
  verifierAddress: string;
  verifyUrlBase: string;
  chainId: number;
  /**
   * 0x-prefixed 20-byte address identifying the agent. Defaults to
   * empty string here; the plugin entry replaces it with the
   * auto-generated wallet's address before building runtime state.
   */
  agentId: string;
  modelId: string;
  /**
   * Name of the env var holding the signer private key. Defaults to
   * "PRIVATE_KEY". The actual key is read from `process.env[<name>]` at
   * session-end time so it never sits in the OpenClaw config file.
   */
  privateKeyEnvVar: string;
}

export type ConfigResolution =
  | { ok: true; config: VerifiableExecutionConfig; appliedDefaults: string[] }
  | { ok: false; missing: string[]; invalid: string[] };

export function resolveConfig(
  pluginConfig: Record<string, unknown> | undefined,
): ConfigResolution {
  const cfg = pluginConfig ?? {};
  const invalid: string[] = [];
  const appliedDefaults: string[] = [];

  // ---- string field with default fallback --------------------------------
  const stringWithDefault = (
    key: keyof Omit<VerifiableExecutionConfig, "chainId" | "agentId" | "privateKeyEnvVar">,
  ): string => {
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) return v;
    appliedDefaults.push(String(key));
    return GALILEO_TESTNET_DEFAULTS[key];
  };

  // ---- address field: default if missing, validate if provided -----------
  const addressWithDefault = (
    key: "agenticIdAddress" | "verifierAddress",
  ): string => {
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) {
      if (!ADDRESS_HEX_RE.test(v)) {
        invalid.push(`${key} (not a 0x-prefixed 20-byte hex address)`);
        return v;
      }
      return v;
    }
    appliedDefaults.push(key);
    return GALILEO_TESTNET_DEFAULTS[key];
  };

  // ---- chainId: default if missing, validate if provided -----------------
  const chainIdWithDefault = (): number => {
    const v = cfg.chainId;
    if (v === undefined || v === null) {
      appliedDefaults.push("chainId");
      return GALILEO_TESTNET_DEFAULTS.chainId;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      invalid.push("chainId (must be a positive integer)");
      return 0;
    }
    return v;
  };

  // ---- agentId: optional here, plugin entry fills from wallet ------------
  const agentIdValidated = (): string => {
    const v = cfg.agentId;
    if (typeof v !== "string" || v.length === 0 || v === ZERO_ADDRESS) {
      // Leave as empty string — index.ts replaces with wallet.address
      // after wallet resolution. Tracking as "applied default" because
      // it IS auto-filled, just downstream of here.
      appliedDefaults.push("agentId");
      return "";
    }
    if (!ADDRESS_HEX_RE.test(v)) {
      invalid.push("agentId (not a 0x-prefixed 20-byte hex address)");
      return v;
    }
    return v;
  };

  const config: VerifiableExecutionConfig = {
    rpcUrl: stringWithDefault("rpcUrl"),
    indexerUrl: stringWithDefault("indexerUrl"),
    agenticIdAddress: addressWithDefault("agenticIdAddress"),
    verifierAddress: addressWithDefault("verifierAddress"),
    verifyUrlBase: stringWithDefault("verifyUrlBase"),
    chainId: chainIdWithDefault(),
    agentId: agentIdValidated(),
    modelId: stringWithDefault("modelId"),
    privateKeyEnvVar:
      typeof cfg.privateKeyEnvVar === "string" && cfg.privateKeyEnvVar.length > 0
        ? cfg.privateKeyEnvVar
        : "PRIVATE_KEY",
  };

  if (invalid.length > 0) {
    // Only an INVALID override is a hard failure. Missing fields are
    // recoverable via defaults; bogus user-supplied values are not (we
    // can't guess what they meant).
    return { ok: false, missing: [], invalid };
  }
  return { ok: true, config, appliedDefaults };
}
