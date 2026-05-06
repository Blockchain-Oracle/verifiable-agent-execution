/**
 * AgenticIDClient — ethers v6 wrapper over the pre-deployed AgenticID
 * contract on Galileo (`0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F`).
 *
 * Source of truth (verified by `scripts/smoke/agenticid.ts` against the
 * live contract):
 *   - Source file: `0gfoundation/agenticID-examples/examples/01-mint-and-manage/
 *     contracts/AgenticID.sol`
 *   - `iMint(address, IntelligentData[]) payable returns (uint256)` —
 *     mintFee is 0 on the deployed contract, so msg.value is not needed.
 *   - `getIntelligentDatas(uint256) view returns (IntelligentData[])`
 *   - Event `IntelligentDataSet(uint256 indexed tokenId, IntelligentData[] data)`
 *     is emitted by `iMint` and is how we recover the new tokenId.
 *
 * ADR-08 in `context/docs/architecture.md` documents the choice to use
 * the example contract (vs. production `0g-agent-nft/AgentNFT.sol`) for
 * hackathon scope.
 */

import { Contract, Interface, JsonRpcProvider, Wallet } from "ethers";
import type {
  ContractRunner,
  ContractTransactionResponse,
  EventLog,
  Log,
  Provider,
  Signer,
  TransactionReceipt,
} from "ethers";

import {
  AgenticIDInputError,
  AgenticIDMintError,
  AgenticIDMintEventDataMismatchError,
  AgenticIDMintEventMissingError,
  AgenticIDReadError,
} from "./errors.js";
import {
  addressSchema,
  bytes32Schema,
  type IntelligentData,
  intelligentDataSchema,
  type MintResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// ABI — the only surface this client needs from AgenticID.sol
// ---------------------------------------------------------------------------

export const AGENTICID_ABI = [
  "function iMint(address to, (string dataDescription, bytes32 dataHash)[] datas) payable returns (uint256)",
  "function getIntelligentDatas(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function mintFee() view returns (uint256)",
  "function creator() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "event IntelligentDataSet(uint256 indexed tokenId, (string dataDescription, bytes32 dataHash)[] data)",
  "event IntelligentTransfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;

const AGENTICID_INTERFACE = new Interface(AGENTICID_ABI);

// ---------------------------------------------------------------------------
// Config / public types
// ---------------------------------------------------------------------------

export interface AgenticIDClientOptions {
  /**
   * Optional pre-built Contract (lets unit tests inject a test double
   * without standing up an Indexer/JsonRpcProvider). In production,
   * omit and the client builds `new Contract(contractAddress, ABI, runner)`.
   */
  contract?: AgenticIDContractLike;
}

/**
 * Subset of the AgenticID contract surface the client uses. Tests can
 * substitute a test double matching this shape.
 */
export interface AgenticIDContractLike {
  iMint(
    to: string,
    datas: ReadonlyArray<IntelligentData>,
  ): Promise<ContractTransactionResponse>;
  getIntelligentDatas(tokenId: bigint): Promise<ReadonlyArray<IntelligentData>>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AgenticIDClient {
  private readonly contract: AgenticIDContractLike;
  /**
   * True when the underlying contract was constructed with a Signer (or
   * an injected test double counts as writable). False when the runner
   * is provider-only (read-only access). `mint()` requires this true.
   */
  private readonly writable: boolean;
  /** Stored for diagnostic display + matching event topics on receipts. */
  readonly contractAddress: string;

  /**
   * BDD-positional constructor (story-agenticid-client):
   *   `new AgenticIDClient(agenticIdAddress, provider, signer)`
   *
   * The trailing `options` arg is non-BDD escape hatch for tests that
   * need to inject a Contract test double without going through the
   * provider+ABI wiring. Pass `{ contract }` to use a stub.
   *
   * Either `provider` OR `options.contract` must be present. `signer`
   * is required for `mint()`; read-only callers may omit it (or pass
   * the same signer for both).
   */
  constructor(
    agenticIdAddress: string,
    provider?: Provider,
    signer?: Signer,
    options: AgenticIDClientOptions = {},
  ) {
    if (!addressSchema.safeParse(agenticIdAddress).success) {
      throw new AgenticIDInputError(
        `contractAddress is not a valid 0x-prefixed 20-byte address: ${agenticIdAddress}`,
      );
    }
    this.contractAddress = agenticIdAddress;

    if (options.contract) {
      // Test-double path: assume writable so tests don't need to construct a
      // real Signer. Production callers don't take this path.
      this.contract = options.contract;
      this.writable = true;
      return;
    }

    if (signer === undefined && provider === undefined) {
      throw new AgenticIDInputError(
        "AgenticIDClient needs at least one of: provider, signer, or options.contract",
      );
    }

    // Production path: build Contract from provider + signer.
    //
    // Provider/signer wiring rules (Codex P1 round 1 = unconnected signer
    // + provider missing; Codex P1 round 2 on PR #19 = SILENT mismatch
    // when the signer is already bound to a DIFFERENT provider):
    //   - signer with no .provider + explicit provider → connect them
    //   - signer with a .provider matching the explicit one → use as-is
    //   - signer with a .provider DIFFERENT from the explicit one → THROW
    //     (silently picking one would let `mint()` go to the wrong chain
    //     while the caller believed they targeted the explicit RPC —
    //     a high-impact correctness risk for on-chain anchoring)
    //   - signer alone (no explicit provider) → use signer's provider
    let runner: ContractRunner;
    if (signer !== undefined) {
      let connectedSigner: Signer;
      if (signer.provider === null) {
        connectedSigner =
          provider !== undefined ? signer.connect(provider) : signer;
      } else if (provider !== undefined && signer.provider !== provider) {
        throw new AgenticIDInputError(
          "AgenticIDClient received both `provider` and a `signer` already " +
            "connected to a different provider. Refusing to construct — silently " +
            "preferring one would let mint() go to the wrong chain while the " +
            "caller believed they targeted the explicit provider. Pass either " +
            "(a) a signer with no .provider and the explicit provider, or " +
            "(b) a signer already connected to the same provider, or " +
            "(c) only the signer (its bound provider is used).",
        );
      } else {
        connectedSigner = signer;
      }
      runner = connectedSigner;
    } else {
      runner = provider as Provider;
    }

    this.contract = new Contract(
      agenticIdAddress,
      AGENTICID_ABI,
      runner,
    ) as unknown as AgenticIDContractLike;
    this.writable = signer !== undefined;
  }

  /**
   * Convenience factory for production wiring from an RPC URL +
   * private key. Equivalent to:
   *   const provider = new JsonRpcProvider(rpcUrl);
   *   const signer   = new Wallet(privateKey, provider);
   *   new AgenticIDClient(addr, provider, signer);
   *
   * Wallet is statically imported at the top of this file so this
   * helper works in native-ESM contexts (the package is "type":
   * "module"). Closes Codex round 2 P1 — `require("ethers")` would
   * have thrown at runtime in ESM.
   */
  static fromRpc(
    agenticIdAddress: string,
    rpcUrl: string,
    privateKey?: string,
  ): AgenticIDClient {
    const provider = new JsonRpcProvider(rpcUrl);
    if (privateKey) {
      const signer = new Wallet(privateKey, provider);
      return new AgenticIDClient(agenticIdAddress, provider, signer);
    }
    return new AgenticIDClient(agenticIdAddress, provider);
  }

  /**
   * Mint a new AgenticID token with the given IntelligentData entries.
   *
   * Calls `iMint(to, datas)` with no msg.value (mintFee is 0 on the
   * deployed contract; verified). Waits for the receipt and parses the
   * `IntelligentDataSet(tokenId, data)` event to recover the assigned
   * tokenId. Throws `AgenticIDMintError` on tx failure / RPC issue;
   * throws `AgenticIDMintEventMissingError` if the event isn't present
   * in the receipt (would mean the contract changed).
   *
   * @param to              recipient address
   * @param datas           IntelligentData entries to attach
   * @param confirmations   optional block confirmations to wait for.
   *                        Defaults to 1 (matches story BDD: "Waits for
   *                        confirmation (or a specified block count)").
   *                        Pass 2+ for higher safety on mainnet.
   */
  async mint(
    to: string,
    datas: ReadonlyArray<IntelligentData>,
    confirmations?: number,
  ): Promise<MintResult> {
    if (!this.writable) {
      throw new AgenticIDInputError(
        "mint() requires a Signer. Construct AgenticIDClient with the third argument (signer) set, " +
          "or pass options.contract pre-bound to a writable runner.",
      );
    }
    if (!addressSchema.safeParse(to).success) {
      throw new AgenticIDInputError(
        `mint() recipient is not a valid 0x-prefixed 20-byte address: ${to}`,
      );
    }
    if (datas.length === 0) {
      throw new AgenticIDInputError(
        "mint() requires at least one IntelligentData entry (the AgenticID `iMint` reverts with 'Empty data array' otherwise)",
      );
    }
    if (confirmations !== undefined && (!Number.isInteger(confirmations) || confirmations < 1)) {
      throw new AgenticIDInputError(
        `mint() confirmations must be a positive integer; got ${confirmations}`,
      );
    }
    for (const [i, d] of datas.entries()) {
      const result = intelligentDataSchema.safeParse(d);
      if (!result.success) {
        throw new AgenticIDInputError(
          `mint() datas[${i}] is malformed: ${result.error.message}`,
        );
      }
    }

    let tx: ContractTransactionResponse;
    try {
      tx = await this.contract.iMint(to, datas);
    } catch (cause) {
      throw new AgenticIDMintError(
        `iMint tx failed before broadcast: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }

    let receipt: TransactionReceipt | null;
    try {
      // Pass `confirmations` per BDD ("Waits for confirmation (or a
      // specified block count)"). Default ethers behavior is 1 conf.
      receipt = await tx.wait(confirmations);
    } catch (cause) {
      throw new AgenticIDMintError(
        `iMint tx reverted or receipt fetch failed (txHash=${tx.hash}): ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
    if (receipt === null) {
      throw new AgenticIDMintError(
        `iMint receipt was null (txHash=${tx.hash}); the tx may have been replaced or dropped.`,
      );
    }

    const { tokenId, data: eventData } = parseMintEventFromReceipt(
      receipt,
      this.contractAddress,
    );

    // BDD: "the event confirms the data anchor" — verify the event's
    // data payload exactly matches the IntelligentData we asked the
    // contract to mint. Without this, a contract bug, reordered
    // receipt, or stray IntelligentDataSet from an unrelated mint
    // could surface as our tokenId+data while pointing at different
    // anchor content. (Codex round 6 on PR #19.)
    assertEventDataMatches(datas, eventData, tx.hash);

    return { tokenId, txHash: tx.hash };
  }

  /**
   * Read the IntelligentData[] for a given token. Returns an empty array
   * for tokens that don't exist OR have no data set (the deployed example
   * contract reverts for non-existent tokens; we surface that as an
   * AgenticIDReadError so callers can distinguish "no data" from "no token").
   */
  async getIntelligentDatas(tokenId: bigint): Promise<IntelligentData[]> {
    if (tokenId < 0n) {
      throw new AgenticIDInputError(
        `tokenId must be non-negative; got ${tokenId.toString()}`,
      );
    }
    let raw: ReadonlyArray<IntelligentData>;
    try {
      raw = await this.contract.getIntelligentDatas(tokenId);
    } catch (cause) {
      throw new AgenticIDReadError(
        `getIntelligentDatas(${tokenId.toString()}) failed: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }

    // ethers returns Result tuples; normalize to plain JSON-shaped objects
    // so consumers don't have to know about ethers' Result class.
    return raw.map((entry) => ({
      dataDescription: entry.dataDescription,
      dataHash: ensureBytes32(entry.dataHash),
    }));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseMintEventFromReceipt(
  receipt: TransactionReceipt,
  contractAddress: string,
): { tokenId: bigint; data: IntelligentData[] } {
  const target = contractAddress.toLowerCase();
  for (const log of receipt.logs as ReadonlyArray<Log | EventLog>) {
    if (log.address.toLowerCase() !== target) continue;
    let parsed: ReturnType<Interface["parseLog"]> = null;
    try {
      parsed = AGENTICID_INTERFACE.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
    } catch {
      continue;
    }
    if (parsed?.name === "IntelligentDataSet") {
      const tokenIdArg = parsed.args.getValue("tokenId") as bigint | number;
      const tokenId =
        typeof tokenIdArg === "bigint" ? tokenIdArg : BigInt(tokenIdArg);
      // ethers v6 returns the tuple-array as a Result; normalize to
      // IntelligentData[] so downstream comparison doesn't have to know
      // about Result. The ABI shape is `(string dataDescription,
      // bytes32 dataHash)[]`.
      const rawData = parsed.args.getValue("data") as ReadonlyArray<{
        dataDescription: string;
        dataHash: string;
      }>;
      const data = rawData.map((entry) => ({
        dataDescription: entry.dataDescription,
        dataHash: entry.dataHash,
      }));
      return { tokenId, data };
    }
  }
  throw new AgenticIDMintEventMissingError(
    `iMint receipt for ${receipt.hash} did not include IntelligentDataSet from ${contractAddress}; ` +
      "cannot recover tokenId. Contract surface may have changed.",
  );
}

/**
 * Assert the event's data payload exactly matches what we asked to
 * mint. Order-preserving: if the contract reordered entries, that
 * counts as a mismatch (because consumers reading via index would see
 * different content). Hex comparisons are case-insensitive (lowercase
 * normalize) since 0G's ABI may emit either case across versions.
 *
 * AUDIT NOTE — why this check exists despite the deployed contract being correct:
 *
 * The pre-deployed AgenticID at 0x2700F6A3...EF1F is 0G's
 * `agenticID-examples/01-mint-and-manage/contracts/AgenticID.sol`.
 * Per source review (`AgenticID.sol:300-306` in /tmp/og-refs/),
 * `_setIntelligentData` emits `IntelligentDataSet(tokenId, datas)`
 * with the EXACT calldata `datas` passed to `iMint`. So for the
 * deployed contract today, this assertion can never fail on a
 * legitimate receipt.
 *
 * We keep the check anyway as a CONTRACT-SURFACE DRIFT DETECTOR:
 *
 *   1. 0G is actively iterating on the agenticID-examples repo. If a
 *      future deployment swaps in a contract with different event
 *      semantics (e.g., emits canonicalized hashes, or a different
 *      tuple shape), this check fails LOUD instead of silently
 *      returning a tokenId pointing at unrelated content.
 *
 *   2. Defense against malformed RPC responses (logs from a different
 *      tx accidentally surfacing in the receipt — rare but documented
 *      in some indexer-RPC bugs).
 *
 *   3. Lock-step regression coverage: anyone who refactors `mint()` to
 *      a new event source must update this assertion, making the
 *      coupling explicit instead of implicit.
 *
 * The check costs ~30 LOC + 2 negative tests + 1 error class. We
 * accept that complexity tax for the future-proofing. (Codex round
 * 6 on PR #19 surfaced the gap; audit-and-keep decision documented
 * here per Codex round 8 reviewer dialogue.)
 */
function assertEventDataMatches(
  expected: ReadonlyArray<IntelligentData>,
  actual: ReadonlyArray<IntelligentData>,
  txHash: string,
): void {
  const mismatchPrefix =
    `iMint event data for ${txHash} does not match the minted IntelligentData[] — `;
  if (expected.length !== actual.length) {
    throw new AgenticIDMintEventDataMismatchError(
      `${mismatchPrefix}length mismatch: expected ${expected.length}, got ${actual.length}.`,
    );
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e.dataDescription !== a.dataDescription) {
      throw new AgenticIDMintEventDataMismatchError(
        `${mismatchPrefix}dataDescription[${i}] mismatch: expected ${JSON.stringify(e.dataDescription)}, got ${JSON.stringify(a.dataDescription)}.`,
      );
    }
    if (e.dataHash.toLowerCase() !== a.dataHash.toLowerCase()) {
      throw new AgenticIDMintEventDataMismatchError(
        `${mismatchPrefix}dataHash[${i}] mismatch: expected ${e.dataHash}, got ${a.dataHash}.`,
      );
    }
  }
}

function ensureBytes32(value: string): string {
  if (!bytes32Schema.safeParse(value).success) {
    throw new AgenticIDReadError(
      `Contract returned a dataHash that is not a 0x-prefixed 32-byte hex: ${value}`,
    );
  }
  return value;
}
