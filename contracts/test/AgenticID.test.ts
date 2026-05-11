/**
 * Unit tests for AgenticID.sol — the ERC-7857 implementation we deploy
 * to Galileo + Aristotle. Covers the surface our verifiable-execution
 * OpenClaw plugin relies on:
 *   - constructor (name/symbol/mintFee + role grants)
 *   - mint() / mintWithRole() / iMint() round-trip
 *   - getIntelligentDatas(tokenId) returns what iMint stored
 *   - pause/unpause gating on mint paths
 *   - mintFee enforcement + admin-only setMintFee
 *
 * Out of scope (deferred): iTransferFrom proof verification (the
 * hackathon contract intentionally trusts ownership-based auth — see
 * AgenticID.sol comment), iCloneFrom (not used by our plugin),
 * authorization batching corner cases (max=100 limit verified).
 */

import { expect } from "chai";
import { ethers } from "hardhat";

const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const NAME = "Agentic ID";
const SYMBOL = "AID";
const MINT_FEE = 0n;

interface AgenticIDLike {
  name(): Promise<string>;
  symbol(): Promise<string>;
  mintFee(): Promise<bigint>;
  creator(): Promise<string>;
  mint(
    to: string,
    overrides?: { value?: bigint },
  ): Promise<import("ethers").ContractTransactionResponse>;
  mintWithRole(
    to: string,
  ): Promise<import("ethers").ContractTransactionResponse>;
  iMint(
    to: string,
    datas: Array<{ dataDescription: string; dataHash: string }>,
    overrides?: { value?: bigint },
  ): Promise<import("ethers").ContractTransactionResponse>;
  getIntelligentDatas(
    tokenId: bigint,
  ): Promise<Array<{ dataDescription: string; dataHash: string }>>;
  ownerOf(tokenId: bigint): Promise<string>;
  totalSupply(): Promise<bigint>;
  pause(): Promise<import("ethers").ContractTransactionResponse>;
  unpause(): Promise<import("ethers").ContractTransactionResponse>;
  setMintFee(
    newFee: bigint,
  ): Promise<import("ethers").ContractTransactionResponse>;
  hasRole(role: string, account: string): Promise<boolean>;
  MINTER_ROLE(): Promise<string>;
  OPERATOR_ROLE(): Promise<string>;
  DEFAULT_ADMIN_ROLE(): Promise<string>;
}

async function deployFixture(opts: { mintFee?: bigint } = {}): Promise<{
  contract: AgenticIDLike;
  deployer: import("ethers").Signer;
  user: import("ethers").Signer;
  outsider: import("ethers").Signer;
}> {
  const signers = await ethers.getSigners();
  const [deployer, user, outsider] = signers;
  if (!deployer || !user || !outsider) {
    throw new Error("hardhat must provide ≥3 signers");
  }
  const factory = await ethers.getContractFactory("AgenticID");
  const contract = await factory.deploy(NAME, SYMBOL, opts.mintFee ?? MINT_FEE);
  await contract.waitForDeployment();
  return {
    contract: contract as unknown as AgenticIDLike,
    deployer,
    user,
    outsider,
  };
}

describe("AgenticID — deployment", () => {
  it("stores constructor name / symbol / mintFee", async () => {
    const { contract } = await deployFixture();
    expect(await contract.name()).to.equal(NAME);
    expect(await contract.symbol()).to.equal(SYMBOL);
    expect(await contract.mintFee()).to.equal(MINT_FEE);
  });

  it("sets creator() to the deployer", async () => {
    const { contract, deployer } = await deployFixture();
    expect(await contract.creator()).to.equal(await deployer.getAddress());
  });

  it("grants DEFAULT_ADMIN_ROLE, MINTER_ROLE, OPERATOR_ROLE to the deployer", async () => {
    const { contract, deployer } = await deployFixture();
    const deployerAddr = await deployer.getAddress();
    expect(
      await contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), deployerAddr),
    ).to.equal(true);
    expect(await contract.hasRole(await contract.MINTER_ROLE(), deployerAddr)).to.equal(
      true,
    );
    expect(await contract.hasRole(await contract.OPERATOR_ROLE(), deployerAddr)).to.equal(
      true,
    );
  });
});

describe("AgenticID — mint() (payable)", () => {
  it("returns sequential token IDs starting at 0", async () => {
    const { contract, user } = await deployFixture();
    const userAddr = await user.getAddress();
    await contract.mint(userAddr);
    await contract.mint(userAddr);
    expect(await contract.totalSupply()).to.equal(2n);
    expect(await contract.ownerOf(0n)).to.equal(userAddr);
    expect(await contract.ownerOf(1n)).to.equal(userAddr);
  });

  it("reverts when msg.value < mintFee", async () => {
    const fee = 1_000_000n;
    const { contract, user } = await deployFixture({ mintFee: fee });
    const userAddr = await user.getAddress();
    await expect(contract.mint(userAddr, { value: fee - 1n })).to.be.revertedWith(
      "Insufficient mint fee",
    );
  });

  it("reverts when paused", async () => {
    const { contract, user } = await deployFixture();
    await contract.pause();
    await expect(contract.mint(await user.getAddress())).to.be.revertedWithCustomError(
      contract as unknown as import("ethers").BaseContract,
      "EnforcedPause",
    );
  });
});

describe("AgenticID — iMint() / getIntelligentDatas() round-trip", () => {
  // This is THE critical surface for the verifiable-execution plugin:
  // it iMints with [{dataDescription:"exec-log:<sid>:<model>", dataHash:rootHash}]
  // and the dashboard later reads via getIntelligentDatas(tokenId).
  // If this round-trip drops or reorders entries, every downstream
  // proof falls over.
  it("stores the IntelligentData array verbatim and returns it via getIntelligentDatas", async () => {
    const { contract, user } = await deployFixture();
    const userAddr = await user.getAddress();
    const datas = [
      {
        dataDescription: "exec-log:ses_demo_001:claude-sonnet-4-6",
        dataHash: `0x${"d".repeat(64)}`,
      },
      {
        dataDescription: "container-hash:openclaw-session:foo:bar",
        dataHash: `0x${"e".repeat(64)}`,
      },
    ];
    await contract.iMint(userAddr, datas);
    const tokenId = 0n;
    expect(await contract.ownerOf(tokenId)).to.equal(userAddr);
    const stored = await contract.getIntelligentDatas(tokenId);
    expect(stored.length).to.equal(2);
    expect(stored[0]!.dataDescription).to.equal(datas[0]!.dataDescription);
    expect(stored[0]!.dataHash).to.equal(datas[0]!.dataHash);
    expect(stored[1]!.dataDescription).to.equal(datas[1]!.dataDescription);
    expect(stored[1]!.dataHash).to.equal(datas[1]!.dataHash);
  });

  it("reverts getIntelligentDatas for a non-existent tokenId", async () => {
    const { contract } = await deployFixture();
    await expect(contract.getIntelligentDatas(99n)).to.be.revertedWith(
      "Token does not exist",
    );
  });

  it("emits IntelligentDataSet on iMint", async () => {
    const { contract, user } = await deployFixture();
    const userAddr = await user.getAddress();
    const datas = [{ dataDescription: "x", dataHash: ZERO_BYTES32 }];
    await expect(contract.iMint(userAddr, datas)).to.emit(
      contract as unknown as import("ethers").BaseContract,
      "IntelligentDataSet",
    );
  });
});

describe("AgenticID — mintWithRole()", () => {
  it("allows a MINTER_ROLE holder to mint without a fee", async () => {
    const { contract, deployer, user } = await deployFixture({
      mintFee: 1_000_000n,
    });
    // deployer holds MINTER_ROLE per constructor
    await contract.mintWithRole(await user.getAddress());
    expect(await contract.totalSupply()).to.equal(1n);
  });

  it("reverts for a non-MINTER caller", async () => {
    const { contract, outsider, user } = await deployFixture();
    const outsiderContract = (contract as unknown as import("ethers").BaseContract).connect(
      outsider,
    ) as unknown as AgenticIDLike;
    await expect(
      outsiderContract.mintWithRole(await user.getAddress()),
    ).to.be.revertedWithCustomError(
      contract as unknown as import("ethers").BaseContract,
      "AccessControlUnauthorizedAccount",
    );
  });
});

describe("AgenticID — admin", () => {
  it("setMintFee updates the fee and emits MintFeeUpdated", async () => {
    const { contract } = await deployFixture();
    await expect(contract.setMintFee(42n))
      .to.emit(contract as unknown as import("ethers").BaseContract, "MintFeeUpdated")
      .withArgs(0n, 42n);
    expect(await contract.mintFee()).to.equal(42n);
  });

  it("setMintFee reverts for non-DEFAULT_ADMIN_ROLE callers", async () => {
    const { contract, outsider } = await deployFixture();
    const outsiderContract = (contract as unknown as import("ethers").BaseContract).connect(
      outsider,
    ) as unknown as AgenticIDLike;
    await expect(outsiderContract.setMintFee(99n)).to.be.revertedWithCustomError(
      contract as unknown as import("ethers").BaseContract,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("pause/unpause cycle restores mint", async () => {
    const { contract, user } = await deployFixture();
    await contract.pause();
    await expect(contract.mint(await user.getAddress())).to.be.revertedWithCustomError(
      contract as unknown as import("ethers").BaseContract,
      "EnforcedPause",
    );
    await contract.unpause();
    await contract.mint(await user.getAddress());
    expect(await contract.totalSupply()).to.equal(1n);
  });
});
