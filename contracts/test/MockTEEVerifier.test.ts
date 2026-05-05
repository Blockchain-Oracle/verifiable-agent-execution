/**
 * Unit tests for MockTEEVerifier.sol.
 *
 * Mirrors the production TeeVerifier behavior (same require strings,
 * same byte-length constraints) so any test that passes here will pass
 * unchanged when we swap to the real `0g-agent-nft/TeeVerifier.sol` for
 * the demo. See ADR-06 + story-tee-verifier-contract.
 */

import { expect } from "chai";
import { ethers } from "hardhat";

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

async function deployFixture(): Promise<{
  contract: import("ethers").Contract;
  oracle: import("ethers").HDNodeWallet;
  deployer: import("ethers").Signer;
}> {
  const oracle = ethers.Wallet.createRandom();
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("MockTEEVerifier");
  const contract = await factory.deploy(oracle.address);
  await contract.waitForDeployment();
  return { contract: contract as unknown as import("ethers").Contract, oracle, deployer: deployer! };
}

describe("MockTEEVerifier — deployment", () => {
  it("rejects the zero address as oracle", async () => {
    const factory = await ethers.getContractFactory("MockTEEVerifier");
    await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid tee oracle address",
    );
  });

  it("stores the oracle address and emits OracleAddressUpdated on deploy", async () => {
    const oracle = ethers.Wallet.createRandom();
    const factory = await ethers.getContractFactory("MockTEEVerifier");
    const contract = await factory.deploy(oracle.address);
    await expect(contract.deploymentTransaction()!).to.emit(
      contract,
      "OracleAddressUpdated",
    );
    expect(await (contract as unknown as { teeOracleAddress: () => Promise<string> }).teeOracleAddress()).to.equal(
      oracle.address,
    );
  });
});

describe("MockTEEVerifier.verifyTEESignature", () => {
  it("returns true for a 65-byte sig produced by the configured oracle", async () => {
    const { contract, oracle } = await deployFixture();
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes("hello world"));
    const sigLike = oracle.signingKey.sign(dataHash);
    const ok = await (contract as unknown as {
      verifyTEESignature: (h: string, s: string) => Promise<boolean>;
    }).verifyTEESignature(dataHash, sigLike.serialized);
    expect(ok).to.equal(true);
  });

  it("returns false for a sig produced by a different signer", async () => {
    const { contract } = await deployFixture();
    const stranger = ethers.Wallet.createRandom();
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes("not from oracle"));
    const sigLike = stranger.signingKey.sign(dataHash);
    const ok = await (contract as unknown as {
      verifyTEESignature: (h: string, s: string) => Promise<boolean>;
    }).verifyTEESignature(dataHash, sigLike.serialized);
    expect(ok).to.equal(false);
  });

  it('reverts with "Invalid signature length" for a 64-byte sig', async () => {
    const { contract } = await deployFixture();
    const tooShort = `0x${"a".repeat(128)}`; // 64 bytes
    await expect(
      (contract as unknown as {
        verifyTEESignature: (h: string, s: string) => Promise<boolean>;
      }).verifyTEESignature(ZERO_BYTES32, tooShort),
    ).to.be.revertedWith("Invalid signature length");
  });

  it('reverts with "Invalid signature length" for a 66-byte sig', async () => {
    const { contract } = await deployFixture();
    const tooLong = `0x${"b".repeat(132)}`; // 66 bytes
    await expect(
      (contract as unknown as {
        verifyTEESignature: (h: string, s: string) => Promise<boolean>;
      }).verifyTEESignature(ZERO_BYTES32, tooLong),
    ).to.be.revertedWith("Invalid signature length");
  });
});

describe("MockTEEVerifier.updateOracleAddress", () => {
  it("rotates the oracle and accepts sigs from the new key", async () => {
    const { contract, oracle } = await deployFixture();
    const newOracle = ethers.Wallet.createRandom();

    await expect(
      (contract as unknown as {
        updateOracleAddress: (a: string) => Promise<unknown>;
      }).updateOracleAddress(newOracle.address),
    ).to.emit(contract, "OracleAddressUpdated");

    const dataHash = ethers.keccak256(ethers.toUtf8Bytes("after rotation"));

    const sigFromOldOracle = oracle.signingKey.sign(dataHash);
    const sigFromNewOracle = newOracle.signingKey.sign(dataHash);

    const verify = (contract as unknown as {
      verifyTEESignature: (h: string, s: string) => Promise<boolean>;
    }).verifyTEESignature;
    expect(await verify(dataHash, sigFromOldOracle.serialized)).to.equal(false);
    expect(await verify(dataHash, sigFromNewOracle.serialized)).to.equal(true);
  });

  it("rejects rotation to the zero address", async () => {
    const { contract } = await deployFixture();
    await expect(
      (contract as unknown as {
        updateOracleAddress: (a: string) => Promise<unknown>;
      }).updateOracleAddress(ethers.ZeroAddress),
    ).to.be.revertedWith("Invalid tee oracle address");
  });

  it("rejects rotation by a non-owner", async () => {
    const { contract } = await deployFixture();
    const [, attacker] = await ethers.getSigners();
    await expect(
      (contract as unknown as {
        connect: (signer: import("ethers").Signer) => {
          updateOracleAddress: (a: string) => Promise<unknown>;
        };
      })
        .connect(attacker!)
        .updateOracleAddress(ethers.Wallet.createRandom().address),
    ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
  });
});
