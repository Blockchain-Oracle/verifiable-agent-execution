/**
 * scripts/lib/network.ts — shared network-config resolver for smoke
 * scripts. Single source of truth for "which RPC/indexer/AgenticID am
 * I talking to and on which chain?" so every script doesn't re-roll
 * its own `process.env.X ?? process.env.Y ?? "default"` fallback chain.
 *
 * Mirrors the dashboard's `apps/dashboard/src/lib/env.ts` resolver
 * semantics (zod schema, prefer canonical env name, fall back to
 * legacy alias, then compiled-in default) so the demo scripts and the
 * dashboard see identical env interpretations.
 *
 * Why a shared module: per Abu 2026-05-11 — hybrid testnet/mainnet
 * config should funnel through helpers, not be scattered across every
 * consumer with its own env-fallback ladder.
 */

const TESTNET_DEFAULTS = {
  RPC: "https://evmrpc-testnet.0g.ai",
  INDEXER: "https://indexer-storage-testnet-turbo.0g.ai",
  AGENTICID_ADDRESS: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
  TEE_VERIFIER_ADDRESS: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
  EXPLORER_HOST: "https://chainscan-galileo.0g.ai",
  CHAIN_ID: 16602,
} as const;

const MAINNET_DEFAULTS = {
  RPC: "https://evmrpc.0g.ai",
  INDEXER: "https://indexer-storage-turbo.0g.ai",
  AGENTICID_ADDRESS: "0xC6f7fB1511a7483C6e14258c70529e37ec698937",
  TEE_VERIFIER_ADDRESS: "0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2",
  EXPLORER_HOST: "https://chainscan.0g.ai",
  CHAIN_ID: 16661,
} as const;

export interface NetworkConfig {
  rpcUrl: string;
  indexerUrl: string;
  agenticIdAddress: string;
  teeVerifierAddress: string;
  chainId: number;
  explorerHost: string;
  /** "Aristotle (mainnet)" vs "Galileo (testnet)" — for log lines. */
  networkLabel: string;
}

/**
 * Resolve which 0G network this run targets based on env vars. Order
 * of precedence per field:
 *   1. Explicit env override (ZG_RPC, AGENTICID_ADDRESS, etc.)
 *   2. Legacy alias (ZG_TESTNET_RPC for the RPC; documented in
 *      apps/dashboard/.env.example)
 *   3. Default keyed by CHAIN_ID env (16661 → mainnet block, else testnet)
 *
 * Pass an explicit CHAIN_ID env var on mainnet runs so the defaults
 * resolve to the right block; smoke runs that DON'T set CHAIN_ID get
 * Galileo defaults (safest fallback).
 */
export function resolveNetwork(): NetworkConfig {
  const explicitChainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;
  const isMainnet = explicitChainId === 16661;
  const d = isMainnet ? MAINNET_DEFAULTS : TESTNET_DEFAULTS;

  const rpcUrl =
    process.env.ZG_RPC ?? process.env.ZG_TESTNET_RPC ?? d.RPC;
  const indexerUrl =
    process.env.ZG_INDEXER_RPC ??
    process.env.ZG_TESTNET_INDEXER ??
    d.INDEXER;
  const agenticIdAddress = process.env.AGENTICID_ADDRESS ?? d.AGENTICID_ADDRESS;
  const teeVerifierAddress =
    process.env.TEE_VERIFIER_ADDRESS ?? d.TEE_VERIFIER_ADDRESS;
  const chainId = explicitChainId ?? d.CHAIN_ID;
  const explorerHost = chainId === 16661 ? MAINNET_DEFAULTS.EXPLORER_HOST : TESTNET_DEFAULTS.EXPLORER_HOST;
  const networkLabel = chainId === 16661 ? "Aristotle (mainnet)" : "Galileo (testnet)";

  return {
    rpcUrl,
    indexerUrl,
    agenticIdAddress,
    teeVerifierAddress,
    chainId,
    explorerHost,
    networkLabel,
  };
}

/** Pure predicate — Aristotle mainnet? */
export function isMainnet(chainId: number): boolean {
  return chainId === 16661;
}

/** Chainscan token URL builder. Mirrors the dashboard helper. */
export function chainscanTokenUrl(chainId: number, agenticId: string, tokenId: string | number): string {
  const host = chainId === 16661 ? MAINNET_DEFAULTS.EXPLORER_HOST : TESTNET_DEFAULTS.EXPLORER_HOST;
  return `${host}/token/${agenticId}?a=${tokenId}`;
}
