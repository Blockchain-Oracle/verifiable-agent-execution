/**
 * TEEProofAdapter — verify an agent-wrapper response signature both
 * locally (via ECDSA recovery) and on-chain (via
 * TEEVerifier.verifyTEESignature).
 *
 * Local recovery is cheap and tells us WHO signed; the on-chain call
 * tells us whether that signer matches the verifier contract's
 * configured oracle. Both verdicts are returned so callers can render
 * "TEE Verified" only when BOTH agree.
 *
 * Source of truth:
 *   - Signing protocol: see ./signing-message.ts (mirrors agent-wrapper
 *     internal/sealed/state.go SignWithAgentSealKey + proxy.go
 *     signResponse)
 *   - On-chain verifier: contracts/contracts/MockTEEVerifier.sol +
 *     0g-agent-nft/contracts/TeeVerifier.sol
 *   - Round-trip protocol test: scripts/smoke/tee-headers.ts
 */

import { Contract, getBytes, JsonRpcProvider, recoverAddress } from "ethers";
import type { BytesLike, ContractRunner, Provider } from "ethers";

import { VerifierCallError } from "./errors.js";
import type { AgentWrapperAttestation } from "./HeaderParser.js";
import {
  reconstructSigningMessage,
  signingMessageDigestFromString,
} from "./signing-message.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TEEProofAdapterConfig {
  /** Deployed MockTEEVerifier (or production TeeVerifier) address. */
  verifierAddress?: string;
  /** ethers Provider used to call the verifier. */
  provider?: Provider;
  /**
   * Optional pre-built verifier (for unit tests that inject a test
   * double over the contract surface). If omitted, the adapter wires
   * `new Contract(verifierAddress, ABI, provider)`.
   */
  verifier?: VerifierLike;
  /**
   * Optional RPC URL to construct a JsonRpcProvider when neither
   * `provider` nor `verifier` is given. Convenience for the common
   * production wiring.
   */
  rpcUrl?: string;
}

export interface TEEVerifyResult {
  /**
   * The on-chain verifier's verdict. `true` iff both:
   *   1) the recovered signer matches the configured TEE oracle, AND
   *   2) the contract did not revert on length checks.
   */
  valid: boolean;
  /** keccak256(reconstructedSigningMessage), 0x-prefixed bytes32. */
  dataHash: string;
  /**
   * Signer recovered locally via ECDSA — the address that produced the
   * X-Signature. Always returned (even when `valid: false`) so callers
   * can show a useful "Signed by 0xabc… but not the configured oracle"
   * message in the verifier dashboard.
   */
  recoveredSigner: string;
}

/**
 * Subset of the TEEVerifier surface this adapter calls. Tests substitute
 * a test double matching this shape (no Hardhat/contract deploy needed
 * for unit tests). Signature parameter is `BytesLike` so the production
 * call can pass `getBytes(attestation.signature)` per the BDD spec
 * (story-tee-proof-flow §"calls verifier.verifyTEESignature(dataHash,
 * getBytes(attestation.signature))"); test doubles that accept the hex
 * string also work because `BytesLike` includes string.
 */
export interface VerifierLike {
  verifyTEESignature(
    dataHash: string,
    signature: BytesLike,
  ): Promise<boolean>;
}

const VERIFIER_ABI = [
  "function verifyTEESignature(bytes32 dataHash, bytes signature) view returns (bool)",
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class TEEProofAdapter {
  private readonly verifier: VerifierLike;

  constructor(config: TEEProofAdapterConfig) {
    if (config.verifier) {
      this.verifier = config.verifier;
      return;
    }
    if (!config.verifierAddress) {
      throw new VerifierCallError(
        "TEEProofAdapter requires either a `verifier` test double or a `verifierAddress`",
      );
    }
    const provider: ContractRunner =
      config.provider ??
      (config.rpcUrl ? new JsonRpcProvider(config.rpcUrl) : (() => {
        throw new VerifierCallError(
          "TEEProofAdapter needs a `provider` or `rpcUrl` when `verifier` is not provided",
        );
      })());
    const contract = new Contract(config.verifierAddress, VERIFIER_ABI, provider);
    this.verifier = {
      verifyTEESignature: async (dataHash: string, signature: BytesLike) => {
        const result = await (contract as unknown as {
          verifyTEESignature: (h: string, s: BytesLike) => Promise<boolean>;
        }).verifyTEESignature(dataHash, signature);
        return Boolean(result);
      },
    };
  }

  /**
   * Verify an attestation+body pair against the on-chain verifier.
   *
   * Returns `{valid, dataHash, recoveredSigner}` on a normal verdict
   * (whether true or false). Throws `VerifierCallError` only when the
   * contract call itself fails at the transport layer (RPC down, wrong
   * address, malformed sig length that reverts) — the SessionLogger
   * uses this distinction to mark entries as 'verifier_unreachable'
   * instead of conflating with a real `valid: false` verdict.
   */
  async verify(
    attestation: AgentWrapperAttestation,
    body: string | Uint8Array,
  ): Promise<TEEVerifyResult> {
    const message = reconstructSigningMessage({
      agentId: attestation.agentId,
      sealId: attestation.sealId,
      timestamp: attestation.timestamp,
      body,
    });
    const dataHash = signingMessageDigestFromString(message);

    // Length pre-check. HeaderParser SHOULD have already enforced
    // 65-byte signatures, but if a caller bypasses it and feeds a
    // malformed-length sig directly to verify(), we mirror what the
    // contract would do: surface as VerifierCallError so the
    // SessionLogger marks the entry 'verifier_unreachable' instead of
    // confusing it with a real `valid:false` verdict. Closes Codex P1
    // round 3 — short-circuiting wrong-length sigs as graceful false
    // hid the contract's `signature.length == 65` revert path.
    let sigBytes: Uint8Array;
    try {
      sigBytes = getBytes(attestation.signature);
    } catch (cause) {
      throw new VerifierCallError(
        `Signature is not valid hex: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
    if (sigBytes.length !== SIGNATURE_BYTE_LENGTH) {
      throw new VerifierCallError(
        `Signature length must be ${SIGNATURE_BYTE_LENGTH} bytes (R||S||V); got ${sigBytes.length}`,
      );
    }

    // Local recovery — best-effort. The story BDD says a TAMPERED
    // signature must produce `valid: false` GRACEFULLY, not throw.
    // ethers.recoverAddress can throw on a structurally-broken sig
    // (e.g. v byte flipped from 0x1b to 0x1a → "invalid v"). When
    // that happens we SHORT-CIRCUIT: skip the on-chain verifier (which
    // would also revert via OZ ECDSA.recover) and return valid:false
    // with the ZeroAddress sentinel. This is the BDD-required graceful
    // tampered-proof verdict, distinct from verifier-unreachable.
    //
    // Closes Codex P1 from pre-push review round 2 on epic/02 — round 1
    // only fixed the local-throw path; the on-chain verifier still
    // reverted in production for the same class of broken sig.
    let recoveredSigner: string;
    try {
      recoveredSigner = recoverAddress(dataHash, attestation.signature);
    } catch {
      // Local recovery failed → contract verifier would also revert on
      // the same sig (OZ ECDSA.recover semantics). Short-circuit.
      return { valid: false, dataHash, recoveredSigner: ZERO_ADDRESS };
    }

    let valid: boolean;
    try {
      // BDD spec literal: pass `getBytes(attestation.signature)` (not
      // the hex string) so the contract surface receives the byte array
      // matching `bytes calldata signature` in the Solidity ABI. Already
      // computed `sigBytes` above for the length check.
      valid = await this.verifier.verifyTEESignature(dataHash, sigBytes);
    } catch (cause) {
      // VerifierCallError is reserved for ACTUAL transport failures
      // (RPC down, contract reverts because the address points at the
      // wrong contract, length-check revert because the sig length
      // wasn't validated upstream by HeaderParser). Reaching this
      // catch implies the local recovery succeeded but the contract
      // call still failed — which is genuinely a transport problem.
      throw new VerifierCallError(
        `TEEVerifier.verifyTEESignature reverted or RPC failed: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }

    return { valid, dataHash, recoveredSigner };
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SIGNATURE_BYTE_LENGTH = 65;

