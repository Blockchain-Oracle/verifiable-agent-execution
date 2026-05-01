# SDK Snippets — 0G APAC Hackathon
**Last updated:** 2026-04-30 (refreshed)
**Prior run:** 2026-04-28
**Sources:** docs.0g.ai (scraped 2026-04-28)

---

## 0G Storage TypeScript SDK

### Installation
```bash
npm install @0gfoundation/0g-ts-sdk ethers
```

### Basic upload (TypeScript)
```typescript
import { ZgFile, Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { ethers } from 'ethers';

// Network endpoints — see docs.0g.ai for current values
const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

// Initialize indexer — flow contract is auto-discovered
const indexer = new Indexer(INDEXER_RPC);
```

### Starter kit (upload in under 5 minutes)
```bash
git clone https://github.com/0gfoundation/0g-storage-ts-starter-kit
cd 0g-storage-ts-starter-kit && npm install
cp .env.example .env   # Add your PRIVATE_KEY
npm run upload -- ./file.txt
```

---

## 0G Storage Go SDK

### Installation
```bash
go get github.com/0gfoundation/0g-storage-client
```

### Import
```go
import (
    "context"
    "github.com/0gfoundation/0g-storage-client/common/blockchain"
    "github.com/0gfoundation/0g-storage-client/common"
    "github.com/0gfoundation/0g-storage-client/indexer"
    "github.com/0gfoundation/0g-storage-client/transfer"
    "github.com/0gfoundation/0g-storage-client/core"
)
```

### Initialize clients
```go
// Create Web3 client
w3client := blockchain.MustNewWeb3(evmRpc, privateKey)
defer w3client.Close()

// Create indexer client
indexerClient, err := indexer.NewClient(indRpc, indexer.IndexerClientOption{
    LogOption: common.LogOption{},
})
```

### File upload (Go)
```go
file, err := core.Open(filePath)
defer file.Close()

opt := transfer.UploadOption{
    ExpectedReplica:  1,
    TaskSize:         10,
    SkipTx:           true,
    FinalityRequired: transfer.TransactionPacked,
    FastMode:         true,
    Method:           "min",
    FullTrusted:      true,
}
txHashes, roots, err := indexerClient.SplitableUpload(ctx, w3client, file, fragmentSize, opt)
// Save roots — needed for download
```

### File download (Go)
```go
rootHex := rootHash.String()
err = indexerClient.Download(ctx, rootHex, outputPath, withProof)
// withProof=true enables Merkle proof verification
```

---

## 0G Compute Router (confirmed Apr 30 — RECOMMENDED path)

The Compute Router is simpler than Direct. One API key, OpenAI-compatible, automatic on-chain billing.

### Install
```bash
npm install @0gfoundation/0g-compute-ts-sdk
# (Old name @0glabs/0g-serving-broker is deprecated — re-export shim only.)
```

### Quickstart pattern
```
1. Connect wallet at compute router endpoint
2. Deposit 0G tokens for billing
3. Create API key (3 permission tiers)
4. Send requests to /v1/chat/completions (OpenAI-compatible)
5. Router handles provider selection, failover, billing
```

### Router endpoint features
- Chat completions: `/v1/chat/completions` with streaming, tool calling, reasoning tokens
- Provider routing: by lowest latency, lowest price, or pinned provider
- Rate limits apply per API key tier
- On-chain balance depletes per request; auto-billing

### Docs: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview

---

## 0G Compute SDK (renamed Apr 2026)

### Installation
```bash
npm install @0gfoundation/0g-compute-ts-sdk
# The npm registry marks @0glabs/0g-serving-broker as deprecated:
# "DEPRECATED — renamed to @0gfoundation/0g-compute-ts-sdk. This package is a thin re-export shim for backward compatibility."
```

### Quick test (CLI)
```bash
0g-compute-cli ui start-web
# Opens at http://localhost:3090
```

### Available mainnet models (Apr 28, 2026)

| Model | Type | Verification | Context |
|---|---|---|---|
| `GLM-5-FP8` | Chatbot | TeeML | — |
| `deepseek-chat-v3-0324` | Chatbot | TeeML | — |
| `gpt-oss-120b` | Chatbot | TeeML | — |
| `qwen3-vl-30b-a3b-instruct` | Chatbot | TeeML | — |
| `qwen3.6-plus` | Chatbot | TeeTLS | 1M tokens |
| `whisper-large-v3` | Speech-to-Text | TeeML | — |
| `z-image` | Text-to-Image | TeeML | — |

### Marketplace URL
```
https://compute-marketplace.0g.ai/inference
```

---

## 0G Chain (Mainnet / Testnet)

### Network config
```json
{
  "mainnet": {
    "name": "0G Chain (Aristotle)",
    "chainId": 16661,
    "rpc": "https://evmrpc.0g.ai",
    "explorer": "https://chainscan.0g.ai"
  },
  "testnet": {
    "name": "0G Galileo Testnet",
    "rpc": "https://evmrpc-testnet.0g.ai",
    "explorer": "https://chainscan-galileo.0g.ai",
    "storageExplorer": "https://storagescan-galileo.0g.ai",
    "storageIndexer": "https://indexer-storage-testnet-turbo.0g.ai"
  }
}
```

### Faucet
```
https://faucet.0g.ai
```

---

## 0G Private Computer (NEW — Apr 28, 2026)

OpenAI-compatible API endpoint where all inference runs inside Intel TDX + NVIDIA H100/H200 TEE. Even the operator cannot read prompts/outputs.

**Integration docs:** Check docs.0g.ai for updated Private Computer-specific endpoints (launched today; docs may be in flux).

**What it provides:**
- OpenAI-compatible API — drop-in replacement for any OpenAI SDK call
- TEE attestation on every response — cryptographic proof of sealed execution
- Hardware: Intel TDX + NVIDIA H100/H200
- No operator visibility into prompts or outputs

**Zero OpenClaw integrations exist as of Apr 28, 2026.**

---

## iNFT / ERC-7857

Official 0G contract repo: `https://github.com/0gfoundation/0g-agent-nft`

Key properties of ERC-7857:
- Extends ERC-721 with encrypted metadata storage on 0G Storage
- Secure re-encryption for ownership transfers (re-encryption proxy scheme)
- Oracle verification for ownership/access proofs
- Agents can be minted as iNFTs with embedded intelligence (system prompt, skills, memory) encrypted on 0G Storage
- AIverse marketplace uses ERC-7857 agents
- Ownership transfer → encrypted intelligence re-encrypted for new owner's key

Documentation: `https://docs.0g.ai/concepts/inft`

---

## 0G Agent ID (ERC-8004)

Agent registration and identity standard. Maps agents to verifiable on-chain registries.

Examples repo: `https://github.com/0gfoundation/agenticID-examples`

---

## Official OpenClaw Memory Skill (0gfoundation/0g-memory)

The official 0G Foundation implementation of OpenClaw persistent memory on 0G Storage.

```bash
# OpenClaw skill folder is at:
# https://github.com/0gfoundation/0g-memory/tree/main/openclaw-skills/evermemos
```

Architecture:
- 0G KV Server: key-value storage backend on 0G Storage
- MongoDB + Milvus + ES: local search indexing for semantic retrieval
- `evermemos` Skill: Claude Code / OpenClaw integration layer

**Note:** This is the authoritative "memory on 0G" implementation. Any Track 1 submission in this space must go significantly further (multi-agent, on-chain payment gating, etc.).
