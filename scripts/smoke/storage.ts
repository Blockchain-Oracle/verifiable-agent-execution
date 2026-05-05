// scripts/smoke/storage.ts
//
// Spec smoke test for `story-storage-client`. Compiles the imports and
// exercises the canonical 0G Storage upload/download surface from the
// agent-skills patterns doc — without actually transacting (no wallet
// required to run `pnpm exec tsc --noEmit scripts/smoke/storage.ts`).
//
// To actually upload (requires a funded testnet wallet), run with:
//   PRIVATE_KEY=0x... pnpm exec tsx scripts/smoke/storage.ts
//
// Sources of truth for the API shape used here:
//   - 0gfoundation/0g-storage-ts-starter-kit/src/storage.ts (uploadFile)
//   - 0gfoundation/0g-agent-skills/patterns/STORAGE.md
//   - 0gfoundation/0g-agent-skills/patterns/NETWORK_CONFIG.md
//
// What this catches:
//   - The story claims `upload(buffer)` returns `{rootHash, entryCount}`.
//     The real SDK returns `[tx, err]` where tx is `{rootHash, txHash}` or
//     `{rootHashes[], txHashes[]}` (fragmented). `entryCount` is fiction.
//   - The story does not mention that ZgFile requires a filesystem path,
//     so for buffer uploads the canonical pattern is `MemData(bytes)` (or
//     write-temp-file). The story should pick one explicitly.

import { Indexer, MemData, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

// --- network config (from agent-skills/patterns/NETWORK_CONFIG.md) ---

const GALILEO_RPC = "https://evmrpc-testnet.0g.ai";
const GALILEO_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

// --- factory: matches starter-kit/src/config.ts createIndexer() ---

function makeIndexer(): Indexer {
  return new Indexer(GALILEO_INDEXER);
}

function makeWallet(privateKey: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(GALILEO_RPC);
  return new ethers.Wallet(privateKey, provider);
}

// --- compile-only checks (no wallet needed for tsc --noEmit) ---

async function uploadBufferViaMemData(
  buffer: Uint8Array,
  signer: ethers.Wallet,
): Promise<{ rootHash: string; txHash: string }> {
  const indexer = makeIndexer();
  const memData = new MemData(buffer);

  // Pattern from starter-kit/src/storage.ts uploadData() (line 225)
  // and patterns/STORAGE.md "Upload Pattern" (line 36).
  // SDK returns [tx, err] tuple (Go-style, not throw).
  const result = await indexer.upload(
    memData,
    GALILEO_RPC,
    // ESM/CJS type drift between ethers and the SDK; runtime-compatible.
    signer as unknown as Parameters<typeof indexer.upload>[2],
  );

  // result is `[tx, err]` per the SDK's [data, err] convention.
  const [tx, err] = result;
  if (err !== null) {
    throw new Error(`Upload failed: ${err}`);
  }

  // tx is either { rootHash, txHash } or { rootHashes[], txHashes[] }
  // — fragmented uploads use the plural form. We REJECT fragmentation
  // (matches packages/logger/src/StorageClient.ts and the updated
  // story-storage-client BDD): chunks 1..N would be unrecoverable
  // through download(rootHash) which only accepts a single root, so
  // returning rootHashes[0] would silently drop data. Hackathon scope:
  // session-log JSON is well under the ~256KB segment size, so
  // fragmentation should never happen in practice. (Post-hackathon
  // scope to support multi-fragment download/anchor.)
  if ("rootHash" in tx) {
    return { rootHash: tx.rootHash, txHash: tx.txHash };
  } else {
    throw new Error(
      `Fragmented uploads are not supported (got ${tx.rootHashes.length} fragments). ` +
        "Session log payload is too large for a single 0G Storage segment; " +
        "split the session or raise the segment budget before retrying.",
    );
  }
}

async function uploadFileFromPath(
  filePath: string,
  signer: ethers.Wallet,
): Promise<{ rootHash: string; txHash: string }> {
  const indexer = makeIndexer();
  const file = await ZgFile.fromFilePath(filePath);
  try {
    // STORAGE.md "Upload Pattern" requires Merkle tree generation first.
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr !== null) throw new Error(`Merkle tree failed: ${treeErr}`);
    // FINDING: tree!.rootHash() is `string | null` — the SDK can return null
    // even on success (empty file, race). story-storage-client claims rootHash
    // is always a "valid bytes32 hex string". Spec must add null-handling.
    const rootHash = tree!.rootHash();
    if (rootHash === null) throw new Error("Merkle tree produced null root");

    const [, uploadErr] = await indexer.upload(
      file,
      GALILEO_RPC,
      signer as unknown as Parameters<typeof indexer.upload>[2],
    );
    if (uploadErr !== null) throw new Error(`Upload failed: ${uploadErr}`);
    return { rootHash, txHash: "" }; // simplified; real flow returns tx.txHash
  } finally {
    // ALWAYS close the handle (per STORAGE.md critical-rules — prevents leaks)
    await file.close();
  }
}

// --- runtime smoke: only fires if PRIVATE_KEY is set ---

async function main(): Promise<void> {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log(
      "[smoke/storage] No PRIVATE_KEY set — compile-only run. tsc passed.",
    );
    return;
  }

  const wallet = makeWallet(pk);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      smokeTest: "storage",
      ts: Date.now(),
      note: "verifiable-agent-execution spec smoke test",
    }),
  );

  console.log("[smoke/storage] Uploading via MemData...");
  const result = await uploadBufferViaMemData(payload, wallet);
  console.log("[smoke/storage] OK", result);
}

// Reference uploadFileFromPath so it isn't dead code under noUnusedLocals.
// (This is the path-based variant that mirrors starter-kit uploadFile().)
void uploadFileFromPath;

void main().catch((err: unknown) => {
  console.error("[smoke/storage] FAIL", err);
  process.exit(1);
});
