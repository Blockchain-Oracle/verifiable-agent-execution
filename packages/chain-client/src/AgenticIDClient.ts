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
    // If a signer is supplied without a connected provider, attach the
    // supplied provider via signer.connect(provider) — otherwise writes
    // would fail because ethers Contract calls go through signer.provider
    // for nonces/network state. Closes Codex round 2 P1: the BDD shape
    // is `(addr, provider, signer)` and callers reasonably expect both
    // args to be wired together.
    let runner: ContractRunner;
    if (signer !== undefined) {
      const connectedSigner =
        signer.provider === null && provider !== undefined
          ? signer.connect(provider)
          : signer;
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

    const tokenId = parseTokenIdFromReceipt(receipt, this.contractAddress);
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

function parseTokenIdFromReceipt(
  receipt: TransactionReceipt,
  contractAddress: string,
): bigint {
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
      return typeof tokenIdArg === "bigint" ? tokenIdArg : BigInt(tokenIdArg);
    }
  }
  throw new AgenticIDMintEventMissingError(
    `iMint receipt for ${receipt.hash} did not include IntelligentDataSet from ${contractAddress}; ` +
      "cannot recover tokenId. Contract surface may have changed.",
  );
}

function ensureBytes32(value: string): string {
  if (!bytes32Schema.safeParse(value).success) {
    throw new AgenticIDReadError(
      `Contract returned a dataHash that is not a 0x-prefixed 32-byte hex: ${value}`,
    );
  }
  return value;
}
