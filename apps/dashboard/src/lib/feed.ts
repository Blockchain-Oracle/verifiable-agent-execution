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
  // Ceiling-resolution chain (cheapest first, most expensive last):
  //   1. _nextTokenId() — public getter on newer AgenticID variants.
  //      Reverts on our Epic-7 deploys (which use the upstream
  //      `agenticID-examples/01` source where it's private).
  //   2. totalSupply() — ERC-721 standard, exposed by every AgenticID
  //      variant since it inherits from OpenZeppelin's ERC721Enumerable.
  //      Returns the COUNT of minted tokens. For sequentially-minted
  //      ids starting at 0 this equals (nextTokenId), so latest = N - 1.
  //   3. binarySearchLatestTokenId — last-resort 16-32 RPC walk if
  //      both reverted. The old default before adding totalSupply()
  //      fallback (which made the dashboard cold-start 30s+ on every
  //      cache miss). VPS E2E 2026-05-12: confirmed _nextTokenId()
  //      reverts on 0xd4a5eA…0E38, dashboard binary-searched every
  //      uncached request.
  "function _nextTokenId() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
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
    // Fall to ERC-721 totalSupply() before the binary search — that's
    // a single RPC call and works on every standard AgenticID variant.
    // We only hit binarySearchLatestTokenId for non-enumerable forks
    // where neither getter is exposed.
    try {
      const supply = (await contract.totalSupply()) as bigint;
      latest = supply > 0n ? supply - 1n : 0n;
    } catch {
      latest = await binarySearchLatestTokenId(contract);
    }
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
  // a fixed iteration count — so a real high-volume contract
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

/**
 * Heuristic: does a thrown error correspond to "the token simply does
 * not exist on this contract" (a known revert path with a specific
 * require-string), as opposed to a network/transport/decoding failure?
 *
 * AgenticID.sol's `getIntelligentDatas` reverts with the require-string
 * `"Token does not exist"` when `_ownerOf(tokenId) == address(0)`. Anything
 * else — RPC timeout, indexer 5xx, ABI decode mismatch — is a real
 * problem that should propagate so the caller can fail loudly instead
 * of mistaking infrastructure flakiness for an empty token slot.
 * Closes Codex round-9 P1 finding on PR #23.
 */
function isTokenDoesNotExistRevert(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    reason?: string;
    shortMessage?: string;
    message?: string;
    revert?: { args?: unknown[] };
  };
  // ethers v6 normalizes `require(false, "Token does not exist")` to
  // {code: "CALL_EXCEPTION", reason: "Token does not exist", revert: {…}}.
  if (e.code === "CALL_EXCEPTION") {
    if (typeof e.reason === "string" && e.reason.includes("Token does not exist")) {
      return true;
    }
    // Some providers surface the message but not `.reason`; check shortMessage/message too.
    const combined = `${e.shortMessage ?? ""} ${e.message ?? ""}`;
    if (combined.includes("Token does not exist")) return true;
  }
  return false;
}

async function tokenExists(contract: Contract, id: bigint): Promise<boolean> {
  try {
    await contract.getIntelligentDatas(id);
    return true;
  } catch (err) {
    if (isTokenDoesNotExistRevert(err)) return false;
    // Real failure (RPC down, indexer 5xx, malformed response). Propagate
    // so the binary-search caller surfaces an error instead of silently
    // narrowing toward 0 and reporting an empty feed.
    throw err;
  }
}

async function fetchOneRow(contract: Contract, id: bigint): Promise<FeedRow | null> {
  let datas: ReadonlyArray<{ dataDescription: string; dataHash: string }>;
  try {
    datas = await contract.getIntelligentDatas(id);
  } catch (err) {
    // Distinguish "this token doesn't exist on the contract" (a normal
    // miss during the backward walk — skip the row) from any other
    // failure (RPC down, ABI mismatch — propagate so the caller knows
    // the feed is incomplete).
    if (isTokenDoesNotExistRevert(err)) return null;
    throw err;
  }
  const exec = datas.find((d) => d.dataDescription?.startsWith?.("exec-log:"));
  if (exec === undefined) return null;

  // ownerOf failure is NOT silently masked anymore. Burned tokens are
  // the only case where this should revert on a token that
  // `getIntelligentDatas` accepted, and we don't burn tokens — so a
  // miss here is more likely an RPC blip and surfacing it is honest
  // (per Codex round-9 P2). The whole row is skipped on failure
  // rather than emitting a synthetic 0x000…000 "owner."
  let owner: string;
  try {
    owner = (await contract.ownerOf(id)) as string;
  } catch (err) {
    // Bubble so the caller can decide. fetchRecentFeed / fetchTokensForAgent
    // can drop the row (return null) here — they already filter null.
    if (isTokenDoesNotExistRevert(err)) return null;
    throw err;
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
