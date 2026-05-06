# Story: storage-client

**Epic:** Epic 1 — Execution Logger Core
**Estimated time:** ~1.5h
**Dependencies:** None

---

## Narrative

As a logger developer, I need a thin `StorageClient` over `@0gfoundation/0g-storage-ts-sdk` that can upload a session-log JSON buffer to 0G Storage and download it back, returning the bytes32 Merkle root needed for on-chain anchoring.

**Source of truth (verified by `scripts/smoke/storage.ts`):**
- SDK package: `@0gfoundation/0g-storage-ts-sdk` v1.2.8 (the older `@0gfoundation/0g-ts-sdk` is npm-deprecated; every version redirects to the new name).
- Reference implementation: `0gfoundation/0g-storage-ts-starter-kit/src/storage.ts` — read this before implementing.
- Patterns doc: `0gfoundation/0g-agent-skills/patterns/STORAGE.md`.
- Buffers should be uploaded via `MemData` (in-memory bytes); `ZgFile.fromFilePath` is for filesystem files.

---

## Acceptance criteria

```gherkin
Given `packages/logger/src/StorageClient.ts` is created
And it imports { Indexer, MemData, ZgFile } from "@0gfoundation/0g-storage-ts-sdk"
And `packages/logger/package.json` has dependencies: ethers (~6.13.1), @0gfoundation/0g-storage-ts-sdk (^1.2.8)
When StorageClient is initialized with { rpcUrl, indexerUrl, signer }
And `StorageClient.upload(buffer: Uint8Array)` is called with a valid session-log JSON
Then within 30 seconds it returns:
  {
    rootHash: string;   // bytes32 hex (66 chars, 0x-prefixed) — guaranteed non-null
    txHash:   string;   // primary tx hash for the upload
    txSeq:    number;   // SDK's internal sequence number
  }
And the rootHash is a valid bytes32 hex string

Given the SDK's underlying call returns the fragmented variant
  ({ rootHashes: string[]; txHashes: string[]; txSeqs: number[] })
When StorageClient handles it
Then it throws StorageUploadError naming the fragment count
And the error message instructs the caller to split the session or raise the segment budget
And the upload is NOT treated as successful (chunks 1..N would otherwise be unrecoverable
  through download(rootHash), which only accepts a single root)
# Hackathon scope: session-log JSON is well under the ~256KB segment size, so
# fragmentation should never occur in practice. Multi-fragment download/anchor
# is post-hackathon scope (see ADR-05 and the StorageClient.upload comments).

Given `MerkleTree.rootHash()` returns null (per the SDK type, this is possible)
When upload encounters it
Then upload throws StorageRootHashError with a structured message
And the upload is NOT silently treated as successful

Given the SDK's `[result, err]` tuple has a non-null err
When StorageClient.upload sees it
Then it throws StorageUploadError including err.message — never silently swallows

Given a rootHash returned from upload()
When `StorageClient.download(rootHash)` is called
Then it calls `indexer.downloadToBlob(rootHash, { proof: true })` (verified Merkle proof,
  Node + browser-safe — chosen over the disk-only `indexer.download(...)` so callers
  receive bytes directly without a temp-file round-trip)
And returns a Uint8Array that, parsed as JSON, deep-equals the original upload payload

Given pnpm tsc --noEmit is run on the logger package
Then it exits 0 (the smoke test scripts/smoke/storage.ts compiles too — keep them in lockstep)
```

---

## File modification map

**Create:**
- `packages/logger/src/StorageClient.ts` — class with `upload(buffer)` and `download(rootHash)`. Wraps the canonical `[result, err]` SDK convention into our throw-on-error API.
- `packages/logger/src/errors.ts` — `StorageUploadError`, `StorageRootHashError`, `StorageDownloadError` (typed, structured).
- `packages/logger/tests/storage-client.test.ts` — vitest suite. Includes a unit-level mock-Indexer test (no testnet needed) AND a guarded integration test that runs only when `PRIVATE_KEY` + `ZG_TESTNET_RPC` + `ZG_INDEXER_RPC` are set.

**Update:**
- `packages/logger/src/index.ts` — export `StorageClient` and the error types.
- `packages/logger/package.json` — `@0gfoundation/0g-storage-ts-sdk` (^1.2.8), `ethers` (~6.13.1) as deps.

---

## Shell verification

```bash
# Compile only (no testnet needed):
pnpm --filter=logger exec tsc --noEmit
# Must exit 0.

# Integration test (requires funded testnet wallet):
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export ZG_INDEXER_RPC="https://indexer-storage-testnet-turbo.0g.ai"
export PRIVATE_KEY="<testnet-funded-wallet-key>"
pnpm --filter @verifiable-agent-execution/logger exec vitest run storage-client.test.ts
# Use the SCOPED package name; bare `--filter=logger` does NOT match
# (the workspace package id is @verifiable-agent-execution/logger).
# Should pass with upload + download cycle confirmed against Galileo.
```

---

## Notes for the coding agent

- **Upload buffers via `MemData(bytes)`**, not `ZgFile`. `ZgFile.fromFilePath` is for filesystem files. Writing the buffer to a tempfile and using ZgFile is acceptable but adds unnecessary I/O — `MemData` is the canonical buffer path.
- **The SDK uses Go-style `[result, err]` tuples**, not exceptions. Always destructure as `const [result, err] = await indexer.upload(...)` and throw on `err !== null` yourself. Do not assume `await` will throw.
- **`tree.rootHash()` returns `string | null`.** Treat null as a failure mode (StorageRootHashError) rather than coercing — the smoke test `scripts/smoke/storage.ts` shows the canonical null-check.
- **Always close `ZgFile` handles** in a `finally` block (per `agent-skills/patterns/STORAGE.md` — prevents memory leaks). Not applicable to `MemData`.
- **Verified downloads** — pass `{ proof: true }` to `indexer.downloadToBlob(rootHash, { proof: true })` so the Merkle proof is checked. We use `downloadToBlob` (memory-based, Node + browser-safe) rather than the disk-only `indexer.download(rootHash, path, true)` because the caller wants bytes for direct deserialization, not a tempfile round-trip.
- **Reference reading order:** `0gfoundation/0g-storage-ts-starter-kit/src/storage.ts` `uploadFile` + `uploadData` → `0gfoundation/0g-agent-skills/patterns/STORAGE.md` → this story.
