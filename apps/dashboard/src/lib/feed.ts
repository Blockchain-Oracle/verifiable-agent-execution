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
const FEED_PROBE_DEPTH = 32; // walk this many tokenIds back
const FEED_RESULT_LIMIT = 12;

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
  const provider = new JsonRpcProvider(env.ZG_TESTNET_RPC);
  const contract = new Contract(env.AGENTICID_ADDRESS, AGENTICID_FEED_ABI, provider);

  // Determine the probe ceiling. Try the public _nextTokenId getter
  // first; if it reverts (older contract version), fall back to a
  // generous static ceiling that walks past the latest known tokenId.
  let ceiling: bigint;
  try {
    const next = (await contract._nextTokenId()) as bigint;
    ceiling = next - 1n - FEED_PROBE_CEILING_OFFSET;
  } catch {
    ceiling = 200n;
  }

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
 * For a real explorer this would use ERC-721 `Transfer` events
 * indexed by `to`; the walk approximation is fine for the hackathon
 * demo's volume.
 */
export async function fetchTokensForAgent(
  agentAddress: string,
  limit = 50,
): Promise<FeedRow[]> {
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.ZG_TESTNET_RPC);
  const contract = new Contract(env.AGENTICID_ADDRESS, AGENTICID_FEED_ABI, provider);

  let ceiling: bigint;
  try {
    const next = (await contract._nextTokenId()) as bigint;
    ceiling = next - 1n;
  } catch {
    ceiling = 200n;
  }

  const target = agentAddress.toLowerCase();
  const rows: FeedRow[] = [];
  for (let id = ceiling; id >= 0n && rows.length < limit; id--) {
    const row = await fetchOneRow(contract, id);
    if (row !== null && row.owner.toLowerCase() === target) {
      rows.push(row);
    }
  }
  return rows;
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
