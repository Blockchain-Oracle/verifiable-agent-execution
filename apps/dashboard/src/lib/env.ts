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
  // Pre-deployed AgenticID contract (per ADR-08). 0G's example contract,
  // immutable, public on Galileo.
  AGENTICID_ADDRESS: "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F",
  // TEE verifier contract — deployed 2026-05-06 (block 31847547,
  // tx 0xdd0bd51c06c336d53fd34c8a971c5bd33d7658fc9bf6c0a280b987dd1e5d2ad4).
  // Configured with the demo TEE oracle = 0x3b56...33A3.
  TEE_VERIFIER_ADDRESS: "0x6F96f3789646C873a939c4F5EB8e6d8D67b3E8CE",
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
