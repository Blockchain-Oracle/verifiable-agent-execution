/**
 * config.ts — resolve the plugin's runtime settings.
 *
 * Three-level precedence (most → least):
 *   1. /agentscan_network slash-command choice (persisted at
 *      ~/.agentscan/network.json). When set, FORCES the network-axis
 *      fields (rpcUrl, indexerUrl, agenticIdAddress, verifierAddress,
 *      verifyUrlBase, chainId) to the matching preset — even if
 *      OpenClaw plugin config has explicit values for them. The
 *      slash command is an explicit operator action and outranks
 *      installer-baked defaults. Identity-axis fields (modelId,
 *      agentId, privateKeyEnvVar) are NOT overridden.
 *   2. OpenClaw plugin config (`plugins.entries.verifiable-execution.config`).
 *      Wins over Galileo defaults for any field.
 *   3. Galileo testnet defaults (zero-config install path).
 *
 * What stays validated:
 *   - Address fields, IF provided, must look like 0x-prefixed 20-byte hex.
 *   - chainId, IF provided, must be a positive integer.
 *   - agentId stays empty here — plugin entry fills it from the
 *     auto-generated wallet's address after wallet resolution.
 *
 * v0.4.0 (Codex BLOCK-1 fix): persisted network now FORCES override
 * instead of only filling missing defaults. The returned ConfigResolution
 * carries a `networkOverride` field so register() can log which
 * pluginConfig values were ignored — silent overrides are hostile.
 *
 * v0.4.0 (Codex BLOCK-3 fix): loadPersistedNetworkDetailed distinguishes
 * "file missing" (clean state) from "file corrupt" (operator visibility
 * required). When corrupt, resolveConfig surfaces `corruptNetworkWarning`
 * so register() can log a WARN instead of silently dropping to testnet.
 */

import {
  NETWORK_PRESETS,
  loadPersistedNetworkDetailed,
  type LoadNetworkResult,
  type NetworkName,
} from "./network-config.js";

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

// ---------------------------------------------------------------------------
// Galileo testnet defaults — match `apps/dashboard/src/lib/env.ts` and our
// Epic-7 deployed contracts. These are the FALLBACK defaults when no
// persisted-network choice exists (i.e. fresh install) AND no per-field
// OpenClaw override is set.
// ---------------------------------------------------------------------------

export const GALILEO_TESTNET_DEFAULTS = Object.freeze({
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  agenticIdAddress: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
  verifierAddress: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
  verifyUrlBase: "https://agentscan.online",
  chainId: 16602,
  modelId: "claude-sonnet-4-6",
} as const);

/** Network-axis fields a persisted /agentscan_network choice will force. */
const NETWORK_FIELDS = Object.freeze([
  "rpcUrl",
  "indexerUrl",
  "agenticIdAddress",
  "verifierAddress",
  "verifyUrlBase",
  "chainId",
] as const);

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

/**
 * When a persisted /agentscan_network choice forces network fields,
 * this surfaces (1) which network won and (2) which pluginConfig
 * values were IGNORED. register() logs the latter so operators see
 * that their OpenClaw config has stale network fields the slash
 * command is overriding.
 */
export interface NetworkOverrideInfo {
  network: NetworkName;
  /** Field names where pluginConfig had a value that was overridden. */
  overriddenFields: string[];
}

export type ConfigResolution =
  | {
      ok: true;
      config: VerifiableExecutionConfig;
      appliedDefaults: string[];
      /** Set when /agentscan_network forced network fields. Null otherwise. */
      networkOverride: NetworkOverrideInfo | null;
      /** Set when ~/.agentscan/network.json was present but unreadable. Null otherwise. */
      corruptNetworkWarning: string | null;
    }
  | { ok: false; missing: string[]; invalid: string[] };

export function resolveConfig(
  pluginConfig: Record<string, unknown> | undefined,
): ConfigResolution {
  const cfg = pluginConfig ?? {};
  const invalid: string[] = [];
  const appliedDefaults: string[] = [];

  // ---- persisted network: detailed load (distinguish missing/corrupt) ----
  const persistedResult: LoadNetworkResult = loadPersistedNetworkDetailed();
  let persistedNetwork: NetworkName | null = null;
  let corruptNetworkWarning: string | null = null;
  switch (persistedResult.kind) {
    case "ok":
      persistedNetwork = persistedResult.network;
      break;
    case "missing":
      // Fresh install or clean state — no warning, fall through to defaults.
      break;
    case "corrupt":
      corruptNetworkWarning = `~/.agentscan/network.json is unreadable: ${persistedResult.reason}. Falling back to Galileo testnet defaults — re-run /agentscan_network <network> to restore.`;
      break;
    case "symlink":
      corruptNetworkWarning = `~/.agentscan/network.json is a symlink and was rejected. Falling back to Galileo testnet defaults — remove the symlink and re-run /agentscan_network.`;
      break;
  }

  // ---- defaults: Galileo base, optionally overlaid with preset ----------
  // The `defaults` object is what fills MISSING pluginConfig fields.
  // The `forceNetworkFromPreset` flag (set when persistedNetwork is non-null)
  // separately controls whether we IGNORE pluginConfig values for network
  // fields. Two different operations; one source of truth.
  const preset = persistedNetwork ? NETWORK_PRESETS[persistedNetwork] : null;
  const defaults = preset
    ? Object.freeze({
        ...GALILEO_TESTNET_DEFAULTS,
        rpcUrl: preset.rpcUrl,
        indexerUrl: preset.indexerUrl,
        agenticIdAddress: preset.agenticIdAddress,
        verifierAddress: preset.verifierAddress,
        verifyUrlBase: preset.verifyUrlBase,
        chainId: preset.chainId,
      } as const) as typeof GALILEO_TESTNET_DEFAULTS
    : GALILEO_TESTNET_DEFAULTS;

  // Track which pluginConfig fields the persisted-network forced-override
  // is going to ignore. We compute this BEFORE the resolution loop so
  // the warning lists exactly what was thrown away.
  const overriddenFields: string[] = [];
  if (persistedNetwork) {
    for (const field of NETWORK_FIELDS) {
      const v = cfg[field];
      const presentString = typeof v === "string" && v.length > 0;
      const presentNumber = typeof v === "number";
      if (presentString || presentNumber) {
        // Compare against the preset — only flag as "overridden" if it
        // ACTUALLY differs. A pluginConfig that already matches the
        // preset is harmless, no need to alarm.
        const presetValue = defaults[field as keyof typeof defaults];
        if (v !== presetValue) {
          overriddenFields.push(field);
        }
      }
    }
  }

  // ---- string field with persisted-network-aware precedence -------------
  // When persistedNetwork is set AND key is a network field, the preset
  // always wins (forced override). Otherwise: pluginConfig > defaults.
  const stringWithDefault = (
    key: keyof Omit<VerifiableExecutionConfig, "chainId" | "agentId" | "privateKeyEnvVar">,
  ): string => {
    if (persistedNetwork && (NETWORK_FIELDS as readonly string[]).includes(key)) {
      return defaults[key];
    }
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) return v;
    appliedDefaults.push(String(key));
    return defaults[key];
  };

  // ---- address field with persisted-network-aware precedence ------------
  const addressWithDefault = (
    key: "agenticIdAddress" | "verifierAddress",
  ): string => {
    if (persistedNetwork) {
      // Forced — return preset directly, skip validation of pluginConfig
      // value (we're ignoring it anyway).
      return defaults[key];
    }
    const v = cfg[key];
    if (typeof v === "string" && v.length > 0) {
      if (!ADDRESS_HEX_RE.test(v)) {
        invalid.push(`${key} (not a 0x-prefixed 20-byte hex address)`);
        return v;
      }
      return v;
    }
    appliedDefaults.push(key);
    return defaults[key];
  };

  // ---- chainId with persisted-network-aware precedence ------------------
  const chainIdWithDefault = (): number => {
    if (persistedNetwork) {
      return defaults.chainId;
    }
    const v = cfg.chainId;
    if (v === undefined || v === null) {
      appliedDefaults.push("chainId");
      return defaults.chainId;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      invalid.push("chainId (must be a positive integer)");
      return 0;
    }
    return v;
  };

  // ---- agentId: optional here, plugin entry fills from wallet ----------
  const agentIdValidated = (): string => {
    const v = cfg.agentId;
    if (typeof v !== "string" || v.length === 0 || v === ZERO_ADDRESS) {
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
    return { ok: false, missing: [], invalid };
  }
  return {
    ok: true,
    config,
    appliedDefaults,
    networkOverride: persistedNetwork
      ? { network: persistedNetwork, overriddenFields }
      : null,
    corruptNetworkWarning,
  };
}
