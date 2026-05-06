// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ITEEVerifier} from "./interfaces/ITEEVerifier.sol";

/**
 * @title MockTEEVerifier
 * @notice Dev/demo verifier that mirrors the production
 *         `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol` interface.
 *         Recovers the signer via OZ ECDSA and compares to a configurable
 *         oracle address.
 *
 * @dev    REQUIRED COMPILER SETTINGS for 0G Chain:
 *         - Solidity 0.8.24
 *         - `evmVersion: "cancun"` (without it, ECDSA.recover deploys
 *           but reverts with "invalid opcode" at runtime — ADR-09).
 *
 *         Behavior mirrored from the production contract:
 *         - signature.length == 65 require with the exact revert string
 *           "Invalid signature length" so integration tests are portable
 *           between mock and real.
 *         - Single oracle key. Admin can rotate via `updateOracleAddress`.
 *
 *         For the demo, the oracle is set to the canonical 0G TEE oracle
 *         `0x04581d192d22510ced643eaced12ef169644811a` (hardcoded in
 *         `0g-agent-nft/scripts/deploy/deploy_tee.ts`). For unit tests
 *         the deployer can rotate it to any test wallet via
 *         `updateOracleAddress`.
 */
contract MockTEEVerifier is Ownable, ITEEVerifier {
    using ECDSA for bytes32;

    /// @notice Address whose ECDSA signatures are accepted as valid.
    address public teeOracleAddress;

    /// @notice Emitted when the oracle address is rotated.
    event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle);

    /// @param _teeOracleAddress initial oracle. Pass
    ///        `0x04581d192d22510ced643eaced12ef169644811a` for the demo
    ///        or any test wallet for unit tests.
    constructor(address _teeOracleAddress) Ownable(msg.sender) {
        require(_teeOracleAddress != address(0), "Invalid tee oracle address");
        teeOracleAddress = _teeOracleAddress;
        emit OracleAddressUpdated(address(0), _teeOracleAddress);
    }

    /// @inheritdoc ITEEVerifier
    function verifyTEESignature(bytes32 dataHash, bytes calldata signature)
        external
        view
        override
        returns (bool)
    {
        require(signature.length == 65, "Invalid signature length");
        address signer = dataHash.recover(signature);
        return signer == teeOracleAddress;
    }

    /**
     * @notice Rotate the oracle address. Owner only — typically used in
     *         tests to swap to a known test-wallet address.
     */
    function updateOracleAddress(address newOracleAddress) external onlyOwner {
        require(newOracleAddress != address(0), "Invalid tee oracle address");
        address old = teeOracleAddress;
        teeOracleAddress = newOracleAddress;
        emit OracleAddressUpdated(old, newOracleAddress);
    }
}
