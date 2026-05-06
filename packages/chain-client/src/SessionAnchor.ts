/**
 * SessionAnchor — orchestrates the end-of-session anchoring flow:
 *   1. Sets late-bound metadata (agentId, modelId, containerHash) on the
 *      SessionLogger.
 *   2. Flushes the log to 0G Storage → rootHash.
 *   3. Mints an AgenticID iNFT with `{dataDescription, dataHash:rootHash}`
 *      so the rootHash is permanently anchored on-chain.
 *   4. Returns the tokenId, txHash, rootHash, entryCount, and the
 *      `/verify/<chainId>/<tokenId>` URL the dashboard surfaces.
 *
 * Source of truth:
 *   - context/docs/stories/story-session-mint.md (BDD acceptance)
 *   - context/docs/architecture.md ADR-08 (dataDescription convention:
 *     `exec-log:<sessionId>:<modelId>`)
 *   - context/SOURCE_OF_TRUTH.md (verifyUrl pattern)
 *
 * Dependencies between components:
 *   SessionLogger.flush() requires {agentId, containerHash, modelId} set
 *   first. agentId + modelId are static across a session and are bound
 *   to SessionAnchor at construction. containerHash is per-call (only
 *   known once the OpenClaw container has terminated and produced its
 *   final hash) so it's an `anchor()` argument.
 *
 * sessionId is asserted-equal between the input and the bound
 * SessionLogger to catch caller-side wiring bugs (passing the wrong
 * sessionId would silently mint against a different log).
 */

import type { SessionLogger } from "@verifiable-agent-execution/logger";

import type { AgenticIDClient } from "./AgenticIDClient.js";
import { SessionAnchorError } from "./errors.js";
import {
  addressSchema,
  bytes32Schema,
  type IntelligentData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface SessionAnchorOptions {
  /**
   * EVM chainId baked into the verifyUrl. REQUIRED — the SessionAnchor
   * is intentionally network-agnostic and will not silently default to
   * Galileo. Pass 16602 for Galileo testnet, 16661 for Aristotle mainnet.
   */
  chainId: number;
  /**
   * Block confirmations to wait for before returning. Defaults to 1
   * (matches AgenticIDClient.mint default + story BDD on PR #19).
   * Pass 2+ for production safety on mainnet.
   */
  confirmations?: number;
}

export interface AnchorInput {
  /**
   * MUST equal `sessionLogger.sessionId`. Required redundantly so a
   * caller wiring bug (passing the wrong sessionId to anchor()) fails
   * loud at this layer instead of silently minting against a different
   * session's flushed log.
   */
  sessionId: string;
  /**
   * The OpenClaw container hash captured at session end. 32-byte hex,
   * 0x-prefixed. Late-bound here because the container hash is only
   * known after the container terminates — SessionAnchor sets it on
   * the SessionLogger metadata before calling flush().
   */
  containerHash: string;
}

export interface AnchorResult {
  /** ERC-721 tokenId returned by the AgenticID mint. */
  tokenId: bigint;
  /** Mint transaction hash. */
  txHash: string;
  /** 0G Storage rootHash for the flushed session log (bytes32 hex). */
  rootHash: string;
  /** Count of entries that were anchored (mirrors LogFlushResult). */
  entryCount: number;
  /**
   * Verifier URL pattern `/verify/<chainId>/<tokenId>`. Relative path —
   * the dashboard origin is appended at the call site so the same
   * SessionAnchor can serve preview / staging / prod without re-wiring.
   */
  verifyUrl: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SessionAnchor {
  readonly agentId: string;
  readonly modelId: string;
  private readonly sessionLogger: SessionLogger;
  private readonly agenticIdClient: AgenticIDClient;
  private readonly chainId: number;
  private readonly confirmations: number | undefined;

  /**
   * BDD-positional constructor (story-session-mint):
   *   `new SessionAnchor(sessionLogger, agenticIdClient, agentId, modelId, options)`
   *
   * `options` is required (not optional) because chainId is required
   * and there is no safe default — see SessionAnchorOptions.chainId.
   */
  constructor(
    sessionLogger: SessionLogger,
    agenticIdClient: AgenticIDClient,
    agentId: string,
    modelId: string,
    options: SessionAnchorOptions,
  ) {
    if (!addressSchema.safeParse(agentId).success) {
      throw new SessionAnchorError(
        `agentId must be a 0x-prefixed 20-byte hex address; got: ${agentId}`,
      );
    }
    if (modelId.length === 0) {
      throw new SessionAnchorError("modelId must be a non-empty string");
    }
    if (!Number.isInteger(options.chainId) || options.chainId <= 0) {
      throw new SessionAnchorError(
        `chainId must be a positive integer; got: ${String(options.chainId)}`,
      );
    }
    if (
      options.confirmations !== undefined &&
      (!Number.isInteger(options.confirmations) || options.confirmations < 1)
    ) {
      throw new SessionAnchorError(
        `confirmations must be a positive integer when set; got: ${String(options.confirmations)}`,
      );
    }
    this.sessionLogger = sessionLogger;
    this.agenticIdClient = agenticIdClient;
    this.agentId = agentId;
    this.modelId = modelId;
    this.chainId = options.chainId;
    this.confirmations = options.confirmations;
  }

  /**
   * Run the flush → mint → URL sequence and return the anchor result.
   *
   * Errors surface as their underlying class — flush failures throw
   * StorageUploadError / SessionLoggerError, mint failures throw
   * AgenticIDMintError. SessionAnchorError is reserved for input
   * validation + sessionId/containerHash drift caught at this layer.
   */
  async anchor(input: AnchorInput): Promise<AnchorResult> {
    if (input.sessionId !== this.sessionLogger.sessionId) {
      throw new SessionAnchorError(
        `sessionId mismatch: anchor() received "${input.sessionId}" but the bound ` +
          `SessionLogger is "${this.sessionLogger.sessionId}". Refusing to mint ` +
          "against a session that does not match the flushed log.",
      );
    }
    if (!bytes32Schema.safeParse(input.containerHash).success) {
      throw new SessionAnchorError(
        `containerHash must be 0x-prefixed 32-byte hex; got: ${input.containerHash}`,
      );
    }

    // Late-bind the SessionLogger metadata it requires before flush.
    // SessionLogger.setMetadata throws if the session is already
    // flushed/flushing — that error surfaces as SessionLoggerError so
    // the caller can branch on it.
    this.sessionLogger.setMetadata({
      agentId: this.agentId,
      modelId: this.modelId,
      containerHash: input.containerHash,
    });

    const flushResult = await this.sessionLogger.flush();

    // ADR-08 dataDescription convention. Keeping it as a single string
    // (vs separate fields) because the AgenticID schema is a 2-tuple
    // (description, hash) and we want all the session identity in the
    // description so a third-party verifier can decode without a
    // side-channel lookup.
    const data: IntelligentData = {
      dataDescription: `exec-log:${input.sessionId}:${this.modelId}`,
      dataHash: flushResult.rootHash,
    };

    const mintResult = await this.agenticIdClient.mint(
      this.agentId,
      [data],
      this.confirmations,
    );

    const verifyUrl = `/verify/${this.chainId}/${mintResult.tokenId.toString()}`;

    return {
      tokenId: mintResult.tokenId,
      txHash: mintResult.txHash,
      rootHash: flushResult.rootHash,
      entryCount: flushResult.entryCount,
      verifyUrl,
    };
  }
}
