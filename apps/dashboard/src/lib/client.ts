/**
 * client.ts — fetch wrapper for client-side / external callers of
 * /api/verify/[tokenId].
 *
 * Two consumers in scope:
 *   1. The /verify/[tokenId] page (server component) currently
 *      bypasses this and calls `resolveProof()` directly to skip the
 *      intra-process HTTP hop. If a future client-side variant of
 *      the page lands (e.g., a "live status" component that re-polls
 *      the proof every N seconds), it imports `fetchProof` from here.
 *   2. External integrations (verifier embeds, third-party tools)
 *      that hit the public HTTP API and want a typed wrapper.
 *
 * The wrapper preserves the route's HTTP semantics:
 *   - 2xx → resolves to ProofResponse
 *   - 4xx → throws ProofFetchError with the route's `code` + `message`
 *   - 5xx → throws ProofFetchError with the route's `code` + `message`
 *   - network failure → throws ProofFetchError with code "NETWORK_ERROR"
 */

import type { ProofResponse } from "./verify-proof.js";

export class ProofFetchError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(opts: { status: number; code: string; message: string; cause?: unknown }) {
    super(opts.message, { cause: opts.cause });
    this.name = "ProofFetchError";
    this.status = opts.status;
    this.code = opts.code;
  }
}

export interface FetchProofOptions {
  /**
   * Base URL of the dashboard. Required when calling from a Node
   * runtime (e.g., a script) — fetch needs an absolute URL. In the
   * browser, defaults to the current origin so callers can pass
   * just the tokenId.
   */
  baseUrl?: string;
  /**
   * Optional AbortSignal so callers can cancel an in-flight request
   * (e.g., on route change in a live-polling variant of the page).
   */
  signal?: AbortSignal;
}

export async function fetchProof(
  tokenId: string,
  options: FetchProofOptions = {},
): Promise<ProofResponse> {
  const url = options.baseUrl
    ? `${options.baseUrl.replace(/\/$/, "")}/api/verify/${encodeURIComponent(tokenId)}`
    : `/api/verify/${encodeURIComponent(tokenId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: options.signal,
    });
  } catch (cause) {
    throw new ProofFetchError({
      status: 0,
      code: "NETWORK_ERROR",
      message: `Failed to reach ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  // Try to parse the body whether the response is OK or an error —
  // the API route returns structured errors with the same JSON shape.
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ProofFetchError({
      status: response.status,
      code: "MALFORMED_RESPONSE",
      message: `Server returned ${response.status} but body is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }

  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error ?? {};
    throw new ProofFetchError({
      status: response.status,
      code: typeof err.code === "string" ? err.code : "UNKNOWN_API_ERROR",
      message:
        typeof err.message === "string"
          ? err.message
          : `API returned HTTP ${response.status} with no structured message`,
    });
  }

  return body as ProofResponse;
}
