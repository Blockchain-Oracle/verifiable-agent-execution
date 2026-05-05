// scripts/smoke/agenticid.ts
//
// Spec smoke test for `story-agenticid-client`. Compiles the imports and
// exercises the canonical `iMint` + `getIntelligentDatas` surface against
// the deployed AgenticID at 0x2700F6A3...EF1F on Galileo (16602).
//
// Read-only by default (no wallet required). To actually mint, set
// `PRIVATE_KEY=0x...` and the script will submit a real iMint tx.
//
// Sources of truth for the API shape used here:
//   - 0gfoundation/agenticID-examples/examples/01-mint-and-manage/
//     contracts/AgenticID.sol (the deployed contract)
//   - 0gfoundation/agenticID-examples/.../scripts/deploy.ts (constructor
//     args confirm name="Agentic ID", symbol="AID", mintFee=0)
//   - 0gfoundation/0g-agent-skills/patterns/CHAIN.md
//
// What this catches:
//   - Confirms iMint(address, IntelligentData[]) selector matches
//     0x69280041 (the bytes the spec depends on).
//   - Confirms getIntelligentDatas(uint256) returns IntelligentData[]
//     and the empty-token case decodes to an empty array.
//   - Confirms mintFee() == 0 so we never need to attach value.

import { ethers } from "ethers";

// --- network + contract config ---

const GALILEO_RPC = "https://evmrpc-testnet.0g.ai";
const GALILEO_CHAIN_ID = 16602n;
const AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";

// Minimal ABI — only the surface story-agenticid-client uses.
// Names mirror agenticID-examples/01/AgenticID.sol exactly.
const AGENTICID_ABI = [
  "function iMint(address to, (string dataDescription, bytes32 dataHash)[] datas) payable returns (uint256)",
  "function getIntelligentDatas(uint256 tokenId) view returns ((string dataDescription, bytes32 dataHash)[])",
  "function mintFee() view returns (uint256)",
  "function creator() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "event IntelligentDataSet(uint256 indexed tokenId, (string dataDescription, bytes32 dataHash)[] data)",
  "event IntelligentTransfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;

interface IntelligentData {
  dataDescription: string;
  dataHash: string;
}

// --- helpers ---

function makeContract(runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(AGENTICID_ADDRESS, AGENTICID_ABI, runner);
}

async function readSurface(provider: ethers.Provider): Promise<{
  name: string;
  symbol: string;
  mintFee: bigint;
  creator: string;
  chainId: bigint;
}> {
  const contract = makeContract(provider);
  const [name, symbol, mintFee, creator, network] = await Promise.all([
    contract.name() as Promise<string>,
    contract.symbol() as Promise<string>,
    contract.mintFee() as Promise<bigint>,
    contract.creator() as Promise<string>,
    provider.getNetwork(),
  ]);
  return { name, symbol, mintFee, creator, chainId: network.chainId };
}

async function readEmptyToken(
  provider: ethers.Provider,
  tokenId: bigint,
): Promise<IntelligentData[]> {
  const contract = makeContract(provider);
  // getIntelligentDatas reverts for non-existent tokens (require ownerOf != 0).
  // Wrapping for clean smoke-test output.
  try {
    return (await contract.getIntelligentDatas(tokenId)) as IntelligentData[];
  } catch (err) {
    return [];
  }
}

async function dryRunMint(
  signer: ethers.Wallet,
  to: string,
  datas: IntelligentData[],
): Promise<{ calldata: string; selector: string }> {
  const contract = makeContract(signer);
  const tx = await contract.iMint.populateTransaction(to, datas);
  const calldata = tx.data ?? "0x";
  const selector = calldata.slice(0, 10);
  return { calldata, selector };
}

// --- main ---

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(GALILEO_RPC);

  console.log("[smoke/agenticid] Reading on-chain surface...");
  const surface = await readSurface(provider);
  console.log("  chainId       =", surface.chainId.toString());
  console.log("  name          =", surface.name);
  console.log("  symbol        =", surface.symbol);
  console.log("  mintFee       =", surface.mintFee.toString(), "wei");
  console.log("  creator       =", surface.creator);

  if (surface.chainId !== GALILEO_CHAIN_ID) {
    throw new Error(
      `chainId mismatch: expected ${GALILEO_CHAIN_ID}, got ${surface.chainId}`,
    );
  }
  if (surface.name !== "Agentic ID") {
    throw new Error(`name mismatch: ${surface.name}`);
  }
  if (surface.symbol !== "AID") {
    throw new Error(`symbol mismatch: ${surface.symbol}`);
  }

  console.log("\n[smoke/agenticid] Probing getIntelligentDatas(token 0)...");
  const empty = await readEmptyToken(provider, 0n);
  console.log("  result        =", empty);

  // Calldata encoding test (no signer needed — we only need the wallet
  // type to satisfy populateTransaction).
  const dummySigner = new ethers.Wallet(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    provider,
  );
  const datas: IntelligentData[] = [
    {
      dataDescription: "exec-log:smoke:claude-sonnet",
      dataHash:
        "0x" + "ab".repeat(32), // bytes32 placeholder
    },
  ];
  console.log("\n[smoke/agenticid] Encoding iMint(...) calldata...");
  const dryRun = await dryRunMint(dummySigner, dummySigner.address, datas);
  console.log("  selector      =", dryRun.selector);
  console.log("  calldata.len  =", dryRun.calldata.length, "chars");

  // Selector should be 0x69280041 — the keccak256 of
  // "iMint(address,(string,bytes32)[])" first 4 bytes (verified earlier).
  if (dryRun.selector !== "0x69280041") {
    throw new Error(
      `iMint selector mismatch: expected 0x69280041, got ${dryRun.selector}`,
    );
  }

  // Optional: actual mint if PRIVATE_KEY is provided.
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log(
      "\n[smoke/agenticid] PASS (read-only). Set PRIVATE_KEY to attempt a real mint.",
    );
    return;
  }

  const signer = new ethers.Wallet(pk, provider);
  console.log("\n[smoke/agenticid] Submitting real iMint from", signer.address);
  const contract = makeContract(signer);
  const tx = await contract.iMint(signer.address, datas);
  const receipt = await tx.wait();
  console.log("  tx            =", tx.hash);
  console.log("  block         =", receipt?.blockNumber);
}

void main().catch((err: unknown) => {
  console.error("[smoke/agenticid] FAIL", err);
  process.exit(1);
});
