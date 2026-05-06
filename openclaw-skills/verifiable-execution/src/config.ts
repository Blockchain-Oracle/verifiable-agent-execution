/**
 * config.ts — read + validate the plugin's configSchema-shaped runtime
 * settings. Lives in its own module so both the plugin entry and the
 * SessionManager can call resolveConfig without re-parsing the same
 * `pluginConfig` object multiple times per session.
 *
 * Two failure modes:
 *   1. REQUIRED field missing → returns `{ ok: false, missing: [...] }`
 *      so the entry can log a structured warning + degrade to "logs only,
 *      no anchor" instead of crashing the host (BDD acceptance: "logs a
 *      structured warning to stderr, NOT crashes the host").
 *   2. PRIVATE_KEY env var unset → handled at session-end time, not at
 *      load time, because the plugin should still be installable on a
 *      machine without a funded wallet (operators can wire it later).
 */

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

export interface VerifiableExecutionConfig {
  rpcUrl: string;
  indexerUrl: string;
  agenticIdAddress: string;
  verifierAddress: string;
  verifyUrlBase: string;
  chainId: number;
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
  | { ok: true; config: VerifiableExecutionConfig }
  | { ok: false; missing: string[]; invalid: string[] };

export function resolveConfig(
  pluginConfig: Record<string, unknown> | undefined,
): ConfigResolution {
  const cfg = pluginConfig ?? {};
  const missing: string[] = [];
  const invalid: string[] = [];

  // Helpers — pull a field with type coercion, record missing/invalid as
  // we go so we can report ALL problems in one warning instead of
  // failing on the first.
  const requireString = (key: keyof VerifiableExecutionConfig): string => {
    const v = cfg[key];
    if (typeof v !== "string" || v.length === 0) {
      missing.push(String(key));
      return "";
    }
    return v;
  };
  const requireAddress = (key: keyof VerifiableExecutionConfig): string => {
    const v = requireString(key);
    if (v && !ADDRESS_HEX_RE.test(v)) {
      invalid.push(`${String(key)} (not a 0x-prefixed 20-byte hex address)`);
    }
    return v;
  };
  const requireChainId = (): number => {
    const v = cfg.chainId;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      missing.push("chainId");
      return 0;
    }
    return v;
  };

  const config: VerifiableExecutionConfig = {
    rpcUrl: requireString("rpcUrl"),
    indexerUrl: requireString("indexerUrl"),
    agenticIdAddress: requireAddress("agenticIdAddress"),
    verifierAddress: requireAddress("verifierAddress"),
    verifyUrlBase: requireString("verifyUrlBase"),
    chainId: requireChainId(),
    agentId: requireAddress("agentId"),
    modelId: requireString("modelId"),
    privateKeyEnvVar:
      typeof cfg.privateKeyEnvVar === "string" && cfg.privateKeyEnvVar.length > 0
        ? cfg.privateKeyEnvVar
        : "PRIVATE_KEY",
  };

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, missing, invalid };
  }
  return { ok: true, config };
}
