// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITEEVerifier
 * @notice Mirrors the surface of `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol`
 *         that this project consumes. Production callers should be able
 *         to substitute the real TeeVerifier without modifying call sites.
 *
 * @dev    The function name and signature are LOAD-BEARING — see ADR-06
 *         and `context/REFERENCE_REPO_AUDIT.md` F4. The production
 *         contract requires `signature.length == 65` and recovers the
 *         signer via OpenZeppelin's ECDSA.recover; both behaviors are
 *         mirrored by `MockTEEVerifier.sol`.
 */
interface ITEEVerifier {
    /**
     * @notice Verify that `signature` is a valid 65-byte ECDSA signature
     *         over `dataHash` produced by the configured TEE oracle.
     * @param dataHash 32-byte digest the signature covers.
     * @param signature 65-byte (R || S || V) ECDSA signature.
     * @return ok true iff the recovered signer matches the configured oracle.
     */
    function verifyTEESignature(bytes32 dataHash, bytes calldata signature)
        external
        view
        returns (bool ok);
}
