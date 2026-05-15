/**
 * SessionAnchor — orchestrates the end-of-session anchoring flow:
 *   1. Sets late-bound metadata (agentId, modelId, containerHash) on the
 *      SessionLogger.
 *   2. Flushes the log to 0G Storage → rootHash.
 *   3. Mints an AgenticID iNFT with `{dataDescription, dataHash:rootHash}`
 *      so the rootHash is permanently anchored on-chain.
 *   4. Returns the tokenId, txHash, rootHash, entryCount, and the
 *      `/verify/<tokenId>` URL the dashboard surfaces (network is
 *      implicit from the verifyUrlBase domain — Epic-7 subdomain split,
 *      see ADR-13).
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
import {
  SessionAnchorError,
  SessionAnchorMintAfterFlushError,
} from "./errors.js";
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
   * EVM chainId this anchor is targeting. REQUIRED — informational
   * metadata bound at construction so callers (the plugin, the smoke
   * scripts) can structured-log which network they anchored to. NOT
   * baked into the verifyUrl anymore (Epic-7 design: network is
   * disambiguated by the DOMAIN — testnet at root, mainnet at
   * subdomain — per the Etherscan/Sepolia.Etherscan model). Pass
   * 16602 for Galileo testnet, 16661 for Aristotle mainnet.
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
  /**
   * v0.3.0 optional client-side encryption. When provided, the
   * SessionLog plaintext JSON is transformed by `encrypt()` before
   * upload. The cipher closure owns the key; SessionAnchor + SessionLogger
   * stay key-agnostic. Plugins set up the keystore.setPending →
   * encrypt → keystore.commitPending ordering AROUND this call to
   * survive crashes between flush and mint (see
   * plugin/src/keystore.ts).
   *
   * Return contract: must be a Uint8Array (or Buffer) of upload-ready
   * bytes. Recommended: serialize an `EncryptedSessionLogEnvelope`
   * (`crypto.ts`) and `TextEncoder.encode` the JSON.
   */
  encrypt?: (plaintextJson: string) => Uint8Array;
  /**
   * v0.3.4 — prefix segment of the on-chain `dataDescription`.
   * Defaults to `"exec-log"`. The orphan-recovery branch in the
   * plugin's `handleSessionEnd` passes `"exec-log-orphan"` so the
   * dashboard's centralized parser can render a distinct
   * "recovery anchor" badge for tokens minted because `agent_end`
   * never fired.
   *
   * Why pass through here vs. baking the convention into the plugin:
   * `mintAndBuildResult` builds the final `dataDescription` string
   * itself, so the prefix only lives in one place. Without this hook
   * the orphan branch would need to call `agenticIdClient.mint()`
   * directly, duplicating SessionAnchor's flush-then-mint error
   * handling — including the failure wrap as
   * `SessionAnchorMintAfterFlushError`.
   */
  dataDescriptionPrefix?: string;
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
   * Verifier URL pattern `/verify/<tokenId>` — relative path. The chain
   * (testnet vs mainnet) is disambiguated by the DOMAIN the verifyUrl
   * gets prepended to (e.g., `agentscan.online` = testnet,
   * `mainnet.agentscan.online` = mainnet), matching the Etherscan vs
   * Sepolia.Etherscan model. Do NOT bake chainId into the URL path —
   * the deploy topology already carries it and a path-prefixed chainId
   * forces ugly URLs + dead routes.
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
   * Error semantics:
   *   - Input validation (sessionId mismatch, malformed containerHash)
   *     → SessionAnchorError (no flush, no mint occurred)
   *   - Flush failure (StorageUploadError, SessionLoggerError) →
   *     surfaces UNWRAPPED — the SessionLogger is NOT sealed (the
   *     `flushing` lock resets on upload failure), so the caller can
   *     simply call anchor() again after the underlying issue resolves
   *   - Mint failure AFTER successful flush → wrapped as
   *     SessionAnchorMintAfterFlushError. The SessionLogger IS sealed
   *     (cannot re-flush), so the caller must use `retryMint()` with
   *     the rootHash exposed on the error. (Codex round 8 on PR #19.)
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

    const flushResult = await this.sessionLogger.flush(
      input.encrypt !== undefined ? { encrypt: input.encrypt } : undefined,
    );

    // Mint AFTER successful flush. If mint fails, the SessionLogger
    // is already sealed (flushed=true) and a second `anchor()` would
    // throw ALREADY_FLUSHED — leaving the log uploaded to 0G Storage
    // but never anchored on-chain. Wrap the mint failure as
    // SessionAnchorMintAfterFlushError exposing the rootHash so the
    // caller can recover via retryMint() (or AgenticIDClient.mint()
    // directly). (Codex round 8 on PR #19.)
    return this.mintAndBuildResult(
      input.sessionId,
      flushResult.rootHash,
      flushResult.entryCount,
      input.dataDescriptionPrefix ?? "exec-log",
    );
  }

  /**
   * Retry just the mint step using a previously-flushed rootHash. Use
   * when `anchor()` threw SessionAnchorMintAfterFlushError — the
   * SessionLogger is sealed and cannot be re-flushed, but the on-chain
   * anchor still needs to happen for the proof link to exist.
   *
   * The error class carries `{rootHash, entryCount, sessionId}`; pass
   * those fields here directly. SessionAnchor doesn't track per-call
   * state, so the caller is the source of truth on what to retry —
   * supports the case where the original SessionAnchor instance has
   * already been GC'd (e.g., across a process restart) and the caller
   * persisted the failure context.
   *
   * Throws SessionAnchorError on input validation; throws
   * SessionAnchorMintAfterFlushError if mint fails again — operators
   * can keep retrying with the same rootHash until it succeeds OR
   * fall back to AgenticIDClient.mint() directly.
   */
  async retryMint(input: {
    rootHash: string;
    entryCount: number;
    sessionId: string;
    /**
     * v0.3.4 — same semantics as `AnchorInput.dataDescriptionPrefix`.
     * Operators recovering from `SessionAnchorMintAfterFlushError`
     * pass back `error.dataDescriptionPrefix` so the retry preserves
     * the original prefix (notably for `"exec-log-orphan"` anchors —
     * a recovery retry under `"exec-log"` would mislabel the token).
     * Defaults to `"exec-log"` for backwards compat.
     */
    dataDescriptionPrefix?: string;
  }): Promise<AnchorResult> {
    if (!bytes32Schema.safeParse(input.rootHash).success) {
      throw new SessionAnchorError(
        `retryMint() rootHash must be 0x-prefixed 32-byte hex; got: ${input.rootHash}`,
      );
    }
    if (!Number.isInteger(input.entryCount) || input.entryCount < 0) {
      throw new SessionAnchorError(
        `retryMint() entryCount must be a non-negative integer; got: ${String(input.entryCount)}`,
      );
    }
    if (input.sessionId.length === 0) {
      throw new SessionAnchorError(
        "retryMint() sessionId must be a non-empty string",
      );
    }
    return this.mintAndBuildResult(
      input.sessionId,
      input.rootHash,
      input.entryCount,
      input.dataDescriptionPrefix ?? "exec-log",
    );
  }

  /**
   * Internal: mint with the assembled IntelligentData and convert into
   * an AnchorResult. Wraps mint failures as SessionAnchorMintAfterFlushError
   * so the caller always has the rootHash + retry path on hand.
   *
   * ADR-08 dataDescription convention. Keeping it as a single string
   * (vs separate fields) because the AgenticID schema is a 2-tuple
   * (description, hash) and we want all the session identity in the
   * description so a third-party verifier can decode without a
   * side-channel lookup.
   */
  private async mintAndBuildResult(
    sessionId: string,
    rootHash: string,
    entryCount: number,
    dataDescriptionPrefix: string,
  ): Promise<AnchorResult> {
    const dataDescription = `${dataDescriptionPrefix}:${sessionId}:${this.modelId}`;
    const data: IntelligentData = { dataDescription, dataHash: rootHash };

    let mintResult: Awaited<ReturnType<AgenticIDClient["mint"]>>;
    try {
      mintResult = await this.agenticIdClient.mint(
        this.agentId,
        [data],
        this.confirmations,
      );
    } catch (cause) {
      throw new SessionAnchorMintAfterFlushError({
        rootHash,
        entryCount,
        sessionId,
        dataDescription,
        dataDescriptionPrefix,
        cause,
      });
    }

    // Subdomain-split design: chain is implicit from the verifyUrlBase's
    // domain (testnet at root, mainnet at subdomain). Path stays
    // `/verify/<tokenId>` on both. Matches the dashboard's actual route
    // at `apps/dashboard/src/app/verify/[tokenId]/page.tsx`.
    const verifyUrl = `/verify/${mintResult.tokenId.toString()}`;
    return {
      tokenId: mintResult.tokenId,
      txHash: mintResult.txHash,
      rootHash,
      entryCount,
      verifyUrl,
    };
  }
}
