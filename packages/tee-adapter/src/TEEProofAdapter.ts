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
import type { ContractRunner, Provider } from "ethers";

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
 * for unit tests).
 */
export interface VerifierLike {
  verifyTEESignature(dataHash: string, signature: string): Promise<boolean>;
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
      verifyTEESignature: async (dataHash: string, signature: string) => {
        const result = await (contract as unknown as {
          verifyTEESignature: (h: string, s: string) => Promise<boolean>;
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

    // Local recovery — never throws on a properly-shaped 65-byte sig.
    // If it does throw (e.g. malformed bytes that slipped past the
    // HeaderParser), surface as VerifierCallError so the caller sees
    // a typed error rather than a raw ethers stack.
    let recoveredSigner: string;
    try {
      recoveredSigner = recoverAddress(dataHash, attestation.signature);
    } catch (cause) {
      throw new VerifierCallError(
        `Failed to recover signer from signature: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }

    let valid: boolean;
    try {
      valid = await this.verifier.verifyTEESignature(
        dataHash,
        attestation.signature,
      );
    } catch (cause) {
      throw new VerifierCallError(
        `TEEVerifier.verifyTEESignature reverted or RPC failed: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }

    return { valid, dataHash, recoveredSigner };
  }
}

// Used only to keep `getBytes` referenced — it's the canonical way for
// callers to convert attestation.signature to bytes if they want to do
// their own recovery; we keep it exported via the public surface.
void getBytes;
