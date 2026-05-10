/**
 * env.ts — server-only constants for the verifier dashboard.
 *
 * **Etherscan does not ask you which chain.** Same here. The dashboard
 * serves ONE chain (Galileo testnet for the hackathon demo); every
 * deployed contract address, every RPC, every indexer endpoint is a
 * compiled-in constant. Zero env-vars required to demo.
 *
 * Why these are constants (per first-principles audit, 2026-05-06):
 *   - The judge experience must be: "open URL → see proof". Any env
 *     var the operator has to set BEFORE the dashboard works is
 *     friction we put between the judge and the proof.
 *   - The deployed AgenticID + verifier contract addresses are public,
 *     immutable, and the SAME for every dashboard instance. There's
 *     no scenario where one dashboard instance points at a different
 *     AgenticID — they all serve the same chain.
 *   - Etherscan-style: the chain is the product surface, not a
 *     deployment-time configurable.
 *
 * Override path (advanced / production):
 *   Each constant has a corresponding env var that, if set, OVERRIDES
 *   the default. So:
 *     - Dev/demo: zero env required, defaults work
 *     - Self-host on a different chain (e.g., 0G mainnet): set the
 *       relevant env vars
 *   This keeps the friction-free demo path AND a clean upgrade path.
 */

import { z } from "zod";

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

// ---------------------------------------------------------------------------
// Galileo testnet defaults — public, immutable, compiled in.
//
// To upgrade to mainnet, override with the *_ADDRESS / *_RPC env vars
// (see DashboardEnv at the bottom). Same code path; nothing else changes.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Galileo testnet RPC (chainId 16602). 0G operates this; public + free.
  RPC: "https://evmrpc-testnet.0g.ai",
  // 0G Storage indexer for Galileo. Public.
  INDEXER: "https://indexer-storage-testnet-turbo.0g.ai",
  // Epic-7: AgenticID is now OUR deploy on Galileo (block 32602466,
  // tx 0x57802912cc803e0e1cdd8e88b104fba630c628ac62581804961718c1be5071bd).
  // Source: contracts/contracts/AgenticID.sol (1:1 from
  // 0gfoundation/agenticID-examples/01-mint-and-manage). On mainnet we
  // deploy our own too because 0G has not published a public mainnet
  // example. See ADR-13 (to be added) for the deploy-our-own rationale.
  // Prior testnet default `0x2700F6A3...EF1F` (0G's example) still
  // resolves on-chain — overridable via AGENTICID_ADDRESS env if needed
  // for legacy demo asset compatibility.
  AGENTICID_ADDRESS: "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
  // Epic-7 MockTEEVerifier — deployed 2026-05-10 (block 32610650,
  // tx 0xb321edfd8676c8d98e21087f90c163187ee214a4a9ecf83abcfc5e9761a63316).
  // Configured with the deployer wallet (0x3b56...33A3) as the
  // teeOracleAddress so signatures from our demo signer recover
  // through verifyTEESignature() correctly. Prior testnet verifier
  // `0x6F96f3...8E8CE` still on-chain; overridable via
  // TEE_VERIFIER_ADDRESS env.
  TEE_VERIFIER_ADDRESS: "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
  CHAIN_ID: 16602,
} as const;

// ---------------------------------------------------------------------------
// Override schema — every constant has an OPTIONAL env var that takes
// precedence. Matches the upgrade path: dev uses defaults, prod can
// override per-deployment.
// ---------------------------------------------------------------------------

const envSchema = z.object({
  ZG_TESTNET_RPC: z.string().url().optional(),
  ZG_INDEXER_RPC: z.string().url().optional(),
  AGENTICID_ADDRESS: z.string().regex(ADDRESS_HEX_RE).optional(),
  TEE_VERIFIER_ADDRESS: z.string().regex(ADDRESS_HEX_RE).optional(),
  CHAIN_ID: z.coerce.number().int().positive().optional(),
});

export interface DashboardEnv {
  ZG_TESTNET_RPC: string;
  ZG_INDEXER_RPC: string;
  AGENTICID_ADDRESS: string;
  /**
   * Always present now (compiled-in default). Was previously optional
   * because we hadn't deployed a verifier — we have, the address above
   * is real on Galileo. The "preview" verification status only fires
   * when a session has zero teeSignature entries.
   */
  TEE_VERIFIER_ADDRESS: string;
  CHAIN_ID: number;
}

/**
 * Token ID of the canonical demo session anchored against the current
 * AgenticID default. Hero "Verify the demo session" CTA + verify-page
 * "Try the demo" link + search-bar placeholder all read this so a future
 * AgenticID swap (mainnet) only needs the address + this constant
 * updated in one place.
 *
 * Current: tokenId 0 on AgenticID 0xd4a5eA…0E38 (Galileo, Epic-7).
 */
export const DEMO_TOKEN_ID = 0;

/**
 * Cross-network site URLs — used by TopBar's network chip to link to
 * the OTHER deployment. Overridable via env so each Coolify service can
 * advertise its sibling.
 *
 * Defaults assume the Coolify subdomain split:
 *   testnet → https://verifiable.0g.ai             (default origin)
 *   mainnet → https://mainnet.verifiable.0g.ai     (subdomain)
 *
 * On localhost both default to "" → chip omits the cross-link href so
 * dev mode doesn't render a broken link.
 */
const CROSS_LINK_DEFAULTS = {
  TESTNET_SITE_URL: "https://verifiable.0g.ai",
  MAINNET_SITE_URL: "https://mainnet.verifiable.0g.ai",
} as const;

export interface NetworkBadge {
  label: "TESTNET" | "MAINNET";
  network: "Galileo" | "Aristotle";
  oppositeLabel: "MAINNET" | "TESTNET";
  oppositeUrl: string;
}

export function networkBadge(env: DashboardEnv): NetworkBadge {
  const isMainnet = env.CHAIN_ID === 16661;
  return {
    label: isMainnet ? "MAINNET" : "TESTNET",
    network: isMainnet ? "Aristotle" : "Galileo",
    oppositeLabel: isMainnet ? "TESTNET" : "MAINNET",
    oppositeUrl: isMainnet
      ? process.env.TESTNET_SITE_URL ?? CROSS_LINK_DEFAULTS.TESTNET_SITE_URL
      : process.env.MAINNET_SITE_URL ?? CROSS_LINK_DEFAULTS.MAINNET_SITE_URL,
  };
}

/**
 * Build a chainscan token URL for the active AgenticID + tokenId. Uses
 * the testnet explorer host today; when we swap to mainnet via env
 * override the explorer host should swap too — extend this helper at
 * that time (or thread CHAIN_ID into a chainscanHost lookup).
 */
export function chainscanTokenUrl(env: DashboardEnv, tokenId: string | number): string {
  const host =
    env.CHAIN_ID === 16661
      ? "https://chainscan.0g.ai"
      : "https://chainscan-galileo.0g.ai";
  return `${host}/token/${env.AGENTICID_ADDRESS}?a=${tokenId}`;
}

/**
 * Truncate an address `0xabc…123` style for compact UI rendering.
 * Used by the Footer + ERC-7857 mint copy on the landing page.
 */
export function shortAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 10) return address;
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

/**
 * Resolve dashboard env. NEVER throws on missing vars — every field
 * has a sensible default. Throws ONLY on MALFORMED override values
 * (e.g., AGENTICID_ADDRESS env set to "garbage").
 */
export function loadEnv(): DashboardEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Dashboard env override is malformed: ${issues}. ` +
        "Either fix the override or remove the env var to fall back to the default.",
    );
  }
  return {
    ZG_TESTNET_RPC: result.data.ZG_TESTNET_RPC ?? DEFAULTS.RPC,
    ZG_INDEXER_RPC: result.data.ZG_INDEXER_RPC ?? DEFAULTS.INDEXER,
    AGENTICID_ADDRESS: result.data.AGENTICID_ADDRESS ?? DEFAULTS.AGENTICID_ADDRESS,
    TEE_VERIFIER_ADDRESS:
      result.data.TEE_VERIFIER_ADDRESS ?? DEFAULTS.TEE_VERIFIER_ADDRESS,
    CHAIN_ID: result.data.CHAIN_ID ?? DEFAULTS.CHAIN_ID,
  };
}
