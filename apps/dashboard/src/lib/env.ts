/**
 * env.ts — server-only environment validation. Throws structured
 * errors at module load if required vars are missing, so route
 * handlers fail fast at process start instead of at first request.
 *
 * All vars are read from `process.env` at evaluation time. The
 * dashboard process is responsible for ensuring they're set before
 * Next.js boots (typically via `.env.local` for dev or via the
 * Vercel project's environment configuration in production).
 *
 * IMPORTANT: this module must NOT be imported from client components.
 * Some of these variables (RPC URLs, addresses) are safe to expose
 * via NEXT_PUBLIC_*, but PRIVATE_KEY-class secrets (none in this
 * dashboard — we only do read-only chain calls) would leak. Keep
 * the import boundary on the server (route handlers, server
 * components, lib utilities consumed by them).
 */

import { z } from "zod";

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

const envSchema = z.object({
  ZG_TESTNET_RPC: z.string().url(),
  ZG_INDEXER_RPC: z.string().url(),
  AGENTICID_ADDRESS: z.string().regex(ADDRESS_HEX_RE),
  CHAIN_ID: z.coerce.number().int().positive(),
  // Optional — only required when the route wants to verify TEE
  // signatures (verifier contract address). The /api/verify/[tokenId]
  // endpoint degrades gracefully (returns verified=false) when this
  // is unset, so the dashboard is usable for storage-only proofs
  // before the verifier contract is deployed to mainnet.
  TEE_VERIFIER_ADDRESS: z
    .string()
    .regex(ADDRESS_HEX_RE)
    .optional(),
});

export type DashboardEnv = z.infer<typeof envSchema>;

/**
 * Resolve + validate the dashboard env. Throws ZodError with a
 * detailed message naming every missing/invalid field. Call once
 * per route handler invocation — Next.js caches the module-level
 * evaluation between requests in production.
 */
export function loadEnv(): DashboardEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Dashboard env failed validation: ${issues}. ` +
        "Check apps/dashboard/.env.local (dev) or the Vercel project env (prod).",
    );
  }
  return result.data;
}
