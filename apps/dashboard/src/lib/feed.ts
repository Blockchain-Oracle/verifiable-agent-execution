/**
 * feed.ts — server-side fetch for the live feed of recent agent
 * sessions on AgenticID. Powers the landing page table.
 *
 * AgenticID's tokenId space is monotonically increasing
 * (`_nextTokenId++` per `iMint`), so we walk BACKWARD from a probe
 * ceiling, calling `getIntelligentDatas(tokenId)` per id, and pick
 * the entries whose `dataDescription` starts with `exec-log:` (the
 * verifiable-execution plugin's anchoring convention per ADR-08).
 *
 * Why not subscribe to `IntelligentDataSet` events instead?
 * For a hackathon demo on Galileo testnet (~30 mints/day across the
 * whole contract), walking the last N tokenIds is simpler, cheaper,
 * and avoids an event-log subscription dependency. When the contract
 * sees real volume, swap this for a `queryFilter` against
 * `IntelligentDataSet` topic + an indexer cache.
 */

import { Contract, JsonRpcProvider } from "ethers";

import { loadEnv } from "./env.js";

const FEED_PROBE_CEILING_OFFSET = 0n; // probe FROM nextTokenId-1 backward
const FEED_PROBE_DEPTH = 64; // walk this many tokenIds back
const FEED_RESULT_LIMIT = 12;

/**
 * Bound on `fetchTokensForAgent`'s backward walk. For an address with
 * zero (or very few) sessions, the unbounded walk would scan all the
 * way to tokenId 0 — one RPC call per token, easily a route-timeout
 * for agents with no mints on a contract with thousands of tokens.
 *
 * 1000 tokens covers months of demo activity at hackathon scale.
 * Production should swap this loop for an ERC-721 `Transfer`
 * `queryFilter` indexed by `to=agentAddress` (event-log lookup, O(1)
 * RPC after the filter call). Hackathon scope: a hard bound is enough.
 * Closes Codex round-5 P2 on PR #23.
 */
const AGENT_SCAN_MAX_DEPTH = 1000n;

/**
 * Absolute safety ceiling for the exponential probe in
 * `binarySearchLatestTokenId`. Set astronomically high (2^32) so it
 * effectively never trips on any realistic contract, but prevents an
 * infinite loop if `getIntelligentDatas` would somehow never revert.
 * Closes Codex round-5 P2 on PR #23 (previously hard-capped at 12
 * doublings = 262144, which would silently under-report on contracts
 * with > 262k mints).
 */
const PROBE_SAFETY_CEILING = 1n << 32n;

// Cache the discovered ceiling for ~30s. The deployed AgenticID example
// at 0x2700F6A3…EF1F does NOT expose a working `_nextTokenId` getter
// (call reverts on chain), so we have to discover the highest existing
// tokenId ourselves. Binary search costs ~log₂(N) RPC calls; cache so
// every dashboard request doesn't pay it.
let cachedCeiling: { value: bigint; at: number } | null = null;
const CEILING_TTL_MS = 30_000;

/**
 * Minimal AgenticID ABI for the feed walker. Owner is read alongside
 * each token so the feed can show "minted by 0xAGENT" without a
 * second contract call.
 */
const AGENTICID_FEED_ABI = [
  "function getIntelligentDatas(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function ownerOf(uint256 tokenId) view returns (address)",
  // Older AgenticID example contracts expose `_nextTokenId` only as
  // an internal var; the deployed example exposes a public getter.
  // Fallback strategy: probe a high ceiling if the call reverts.
  "function _nextTokenId() view returns (uint256)",
] as const;

export interface FeedRow {
  tokenId: string;
  /** Owner address from `ownerOf`. */
  owner: string;
  /** dataDescription as anchored on-chain — `exec-log:<sessionId>:<modelId>`. */
  dataDescription: string;
  /** sessionId parsed out of dataDescription. */
  sessionId: string;
  /** modelId parsed out of dataDescription. */
  modelId: string;
  /** rootHash bytes32 hex (the 0G Storage anchor). */
  rootHash: string;
}

/**
 * Walk the contract for recent exec-log tokens. Intentionally O(N) —
 * see module docstring for the swap-when-volume-arrives plan.
 */
export async function fetchRecentFeed(
  limit = FEED_RESULT_LIMIT,
): Promise<FeedRow[]> {
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_RPC);
  const contract = new Contract(env.AGENTICID_ADDRESS, AGENTICID_FEED_ABI, provider);

  const ceiling = await resolveCeiling(contract, FEED_PROBE_CEILING_OFFSET);
  const rows: FeedRow[] = [];
  const start = ceiling;
  const stop = start - BigInt(FEED_PROBE_DEPTH);
  for (let id = start; id >= 0n && id >= stop && rows.length < limit; id--) {
    const row = await fetchOneRow(contract, id);
    if (row !== null) rows.push(row);
  }
  return rows;
}

/**
 * Fetch all exec-log tokens owned by a specific agent address.
 * Same backward-walk strategy + filter on `ownerOf === address`.
 *
 * Bounded by AGENT_SCAN_MAX_DEPTH (1000) so an agent with zero
 * mints doesn't trigger a walk all the way down to tokenId 0
 * (which on a contract with thousands of mints = thousands of RPC
 * calls = route timeout). Documented limit: agents with sessions
 * older than 1000 tokens behind the ceiling won't appear. For real
 * volume swap this loop for an ERC-721 `Transfer` `queryFilter`
 * indexed by `to=agentAddress` (event-log lookup, O(1) RPC).
 * Closes Codex round-5 P2 on PR #23.
 */
export async function fetchTokensForAgent(
  agentAddress: string,
  limit = 50,
): Promise<FeedRow[]> {
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_RPC);
  const contract = new Contract(env.AGENTICID_ADDRESS, AGENTICID_FEED_ABI, provider);

  const ceiling = await resolveCeiling(contract, 0n);
  const target = agentAddress.toLowerCase();
  const rows: FeedRow[] = [];
  const stop = ceiling - AGENT_SCAN_MAX_DEPTH;
  for (
    let id = ceiling;
    id >= 0n && id >= stop && rows.length < limit;
    id--
  ) {
    const row = await fetchOneRow(contract, id);
    if (row !== null && row.owner.toLowerCase() === target) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Resolve the highest existing tokenId. Tries `_nextTokenId()` first
 * (cheap when the contract exposes it); falls back to a binary-search
 * probe via `getIntelligentDatas` when the getter reverts (which is
 * the case for the AgenticID example contract on Galileo as of
 * 2026-05-06 — `_nextTokenId` is internal-only there).
 *
 * Result is module-cached for CEILING_TTL_MS so concurrent dashboard
 * requests don't re-pay the binary search.
 */
async function resolveCeiling(
  contract: Contract,
  offset: bigint,
): Promise<bigint> {
  const now = Date.now();
  if (cachedCeiling !== null && now - cachedCeiling.at < CEILING_TTL_MS) {
    return cachedCeiling.value - offset;
  }
  let latest: bigint;
  try {
    const next = (await contract._nextTokenId()) as bigint;
    latest = next - 1n;
  } catch {
    latest = await binarySearchLatestTokenId(contract);
  }
  cachedCeiling = { value: latest, at: now };
  return latest - offset;
}

/**
 * Find the highest tokenId for which `getIntelligentDatas` does not
 * revert. Two-phase:
 *   1. Exponential probe upward to bracket the answer (start at 64,
 *      double until we hit a non-existent id OR exceed
 *      PROBE_SAFETY_CEILING).
 *   2. Binary search within the bracket for the smallest non-existent
 *      id; the answer is one less.
 * Cost: ~log₂(N) RPC calls (~16-20 for 0–10k token contracts, ~32 at
 * the safety ceiling).
 *
 * Previously hard-capped at 12 doublings (max bracket 262144) which
 * would silently under-report the ceiling on a contract past that
 * count. Now the probe keeps doubling until it finds a non-existent
 * tokenId; PROBE_SAFETY_CEILING is a 2^32 cliff for the rare
 * "contract has indistinguishable revert states" case. Closes Codex
 * round-5 P2 on PR #23.
 */
async function binarySearchLatestTokenId(contract: Contract): Promise<bigint> {
  let lo = 0n;
  let hi = 64n;
  // Phase 1: exponential probe. Bound by PROBE_SAFETY_CEILING — not
  // a hardcoded iteration count — so a real high-volume contract
  // doesn't get silently truncated. The loop exits the FIRST time
  // tokenExists(hi) returns false.
  while (hi < PROBE_SAFETY_CEILING) {
    if (!(await tokenExists(contract, hi))) break;
    lo = hi;
    hi = hi * 2n;
  }
  if (hi >= PROBE_SAFETY_CEILING) {
    // Astronomical case — at 2^32 tokens this contract has more mints
    // than any real ERC-721 in production. Log + return the last
    // confirmed-existing tokenId. Better to under-report by one cycle
    // than to wedge the dashboard with infinite-probe.
    console.warn(
      `[feed] binarySearchLatestTokenId hit safety ceiling ${PROBE_SAFETY_CEILING}; returning lo=${lo}`,
    );
    return lo;
  }
  if (!(await tokenExists(contract, lo))) return 0n;
  // Phase 2: binary search within (lo, hi].
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await tokenExists(contract, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

async function tokenExists(contract: Contract, id: bigint): Promise<boolean> {
  try {
    await contract.getIntelligentDatas(id);
    return true;
  } catch {
    return false;
  }
}

async function fetchOneRow(contract: Contract, id: bigint): Promise<FeedRow | null> {
  let datas: ReadonlyArray<{ dataDescription: string; dataHash: string }>;
  try {
    datas = await contract.getIntelligentDatas(id);
  } catch {
    // Token doesn't exist (contract reverts) → skip.
    return null;
  }
  const exec = datas.find((d) => d.dataDescription?.startsWith?.("exec-log:"));
  if (exec === undefined) return null;

  let owner = "0x0000000000000000000000000000000000000000";
  try {
    owner = (await contract.ownerOf(id)) as string;
  } catch {
    // ownerOf can revert on burned tokens; non-fatal for the feed row.
  }

  const parts = exec.dataDescription.split(":");
  const sessionId = parts[1] ?? "";
  const modelId = parts.slice(2).join(":");

  return {
    tokenId: id.toString(),
    owner,
    dataDescription: exec.dataDescription,
    sessionId,
    modelId,
    rootHash: exec.dataHash,
  };
}
