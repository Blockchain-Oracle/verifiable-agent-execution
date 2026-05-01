# Story: storage-client

**Epic:** Epic 1 — Execution Logger Core  
**Estimated time:** ~1.5h  
**Dependencies:** None

---

## Narrative

As a logger developer, I need a 0G Storage client wrapper so that session logs can be uploaded and their root hash retrieved for on-chain anchoring.

---

## Acceptance criteria

```gherkin
Given `packages/logger/src/StorageClient.ts` is created
And it imports `{ Indexer, ZgFile }` from `@0gfoundation/0g-ts-sdk`
And `packages/logger/package.json` has dependencies: ethers, @0gfoundation/0g-ts-sdk
When StorageClient is initialized with RPC_URL and INDEXER_RPC endpoints
And `StorageClient.upload(buffer: Buffer)` is called with valid session log JSON
Then within 30 seconds it returns an object with shape `{ rootHash: string, entryCount: number }`
And the rootHash is a valid bytes32 hex string (66 characters, 0x-prefixed)

Given a rootHash returned from upload()
When `StorageClient.download(rootHash)` is called
Then it returns a Buffer that when parsed as JSON matches the original upload data
```

---

## File modification map

**Create:**
- `packages/logger/src/StorageClient.ts` — Indexer client initialization, upload() method, download() method
- `packages/logger/tests/storage-client.test.ts` — Integration test with testnet

**Update:**
- `packages/logger/src/index.ts` — Export StorageClient

---

## Shell verification

```bash
# Set up env:
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export ZG_INDEXER_RPC="https://indexer-storage-testnet-turbo.0g.ai"
export PRIVATE_KEY="<testnet-funded-wallet-key>"

# Run test:
pnpm --filter=logger vitest run storage-client.test.ts
# Should pass with upload + download cycle confirmed
```
