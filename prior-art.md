# Prior Art — 0G APAC Hackathon
**Wedge:** Verifiable Agent Execution  
**Date:** 2026-05-01

---

## 1. agent-wrapper (Go TEE lifecycle)

**Repo:** `github.com/0gfoundation/agent-wrapper`  
**State:** Active, ~2 commits as of Apr 28 2026. Fully featured — all modules implemented with test coverage.

### Architecture

The wrapper is a Go binary (`/usr/local/bin/wrapper`) that runs as the container ENTRYPOINT inside a 0G sandbox (Gramine TEE). It acts as a transparent sidecar: the agent framework runs on `:9000`, the wrapper proxies on `:8080` and signs every response. The agent has zero knowledge that the wrapper exists.

```
External → Wrapper :8080 → Agent :9000
                   │
                   ├── TEE attestation (startup)
                   ├── Blockchain lookup (sealId → agentId)
                   ├── 0G Storage config fetch + decrypt
                   ├── Dynamic framework install (pip/npm)
                   └── ECDSA response signing (per-request)
```

Module layout (`internal/`):
- `init/` — HTTP init server, accepts POST `/_internal/init`
- `sealed/` — thread-safe state: sealID, keys, agentID, status FSM
- `attest/` — Attestor client: provision + ECIES key delivery
- `blockchain/` — 0G chain client: sealId→agentId lookup, ITransferred event scanning
- `storage/` — 0G Storage client: file/config download
- `config/` — AES-256-GCM decrypt + AgentConfig validation
- `framework/` — pip/npm dynamic install
- `process/` — agent process start/stop/restart
- `proxy/` — HTTP reverse proxy with per-response signing
- `flow/` — orchestrator that sequences all of the above
- `mock/` — HTTP mock server for testing

### Key execution hooks / interfaces

**Lifecycle state machine** (`internal/sealed/state.go`):
```go
type Status int
const (
    StatusWaitingInit Status = iota
    StatusSealed
    StatusAttesting
    StatusGettingKey
    StatusWaitingEvent
    StatusFetchingMetadata
    StatusFetchingConfig
    StatusInstallingFramework
    StatusStartingAgent
    StatusReady
    StatusError
)
```
Valid transitions are strictly enforced via `IsValidTransition(from, to Status) bool`.

**The `StatusProvider` interface** (`internal/flow/orchestrator.go:27`):
```go
type StatusProvider interface {
    IsFlowComplete() bool
    GetAgentPort() string
}
```
This is the only interface the proxy uses to decide whether to forward traffic.

**AgentConfig struct** (`internal/config/manager.go`, documented in `docs/design.md`):
```go
type AgentConfig struct {
    Framework *Framework        `json:"framework"`
    Runtime   *Runtime          `json:"runtime"`
    Env       map[string]string `json:"env"`
}
type Framework struct {
    Name    string `json:"name"`
    Version string `json:"version"`
}
type Runtime struct {
    EntryPoint string `json:"entryPoint"`
    WorkingDir string `json:"workingDir"`
    AgentPort  int    `json:"agentPort"`
}
```
This config is fetched from 0G Storage (encrypted), decrypted inside the TEE, never touches disk.

**IntelligentData struct** (`internal/blockchain/client.go:39`):
```go
type IntelligentData struct {
    DataDescription string `json:"dataDescription"`
    DataHash        string `json:"dataHash"`
}
```
This is the on-chain pointer: `DataDescription` is a label (e.g., `"agent-config-v1"`), `DataHash` is the 0G Storage key (bytes32).

**ITransferred ABI** (`internal/blockchain/client.go:315`):
```go
const agenticIDABI = `[
    {"type":"event","name":"ITransferred","anonymous":false,"inputs":[
        {"name":"from","type":"address","indexed":true},
        {"name":"to","type":"address","indexed":true},
        {"name":"tokenId","type":"uint256","indexed":true},
        {"name":"entries","type":"tuple[]","indexed":false,"components":[
            {"name":"dataHash","type":"bytes32"},
            {"name":"sealedKey","type":"bytes"}
        ]}
    ]}
]`
```
Each `entries` element is a `(dataHash, sealedKey)` pair. The `sealedKey` is the per-data ECIES-encrypted data key, re-encrypted for the new owner's public key. The wrapper scans Ethereum logs for this event to get the sealed keys on startup.

### TEE attestation flow

Full flow in `internal/flow/orchestrator.go:Run()`:

1. **Wait for `POST /_internal/init`** with `{sealId, tempKey, attestorUrl}`
2. **Generate ECDSA P-256 key pair** inside TEE (`sealed.GenerateKeyPair()`)
3. **Provision call** to Attestor: `POST /provision` with `{seal_id, container_pubkey, image_hash, issued_at, sandbox_signature}`
   - `sandbox_signature = Sign(keccak256("ImageAttestation:" + sealID + ":" + pubkey + ":" + imageHash + ":" + ts))` using TEE's secp256k1 private key
   - Attestor verifies the image hash against TEE measurements
   - Returns `{encrypted_agent_seal_priv}` — ECIES-encrypted with the TEE's ephemeral pubkey
4. **ECIES decrypt** agentSeal private key using `DecryptAgentSealKey()` — uses `go-ethereum/crypto/ecies`
5. **Query agentId** from sealId: `GET /agents/by-seal-id/{sealId}` → `agentId`
6. **Scan ITransferred logs** for the tokenId to get `{dataHash → sealedKey}` mapping
7. **GetIntelligentDatas** from blockchain: `GET /agents/{agentId}/intelligent-datas` → `[]IntelligentData`
8. For each `IntelligentData`, **decrypt sealedKey → dataKey** via `DecryptSealedKey(sealedKey, agentSealPrivECDSA)` (ECIES)
9. **Download encrypted file** from 0G Storage: `GET /file/{dataHash}`
10. **Decrypt config** with AES-256-GCM: `nonce(12 bytes) || ciphertext || tag(16 bytes at end)`
11. **Report status** to Attestor: `POST /status` with `{seal_id, status:"ready", agent_seal_signature}`

### 0G SDK calls found

All are HTTP REST calls (no on-chain direct calls except via `go-ethereum`):

| Call | Target | Signature |
|------|--------|-----------|
| Provision | Attestor | `POST /provision` — `{seal_id, container_pubkey, image_hash, issued_at, sandbox_signature}` |
| GetKey (legacy) | Attestor | `POST /v1/unseal` — `{seal_id, pubkey, image_hash, signature, ts}` |
| ReportStatus | Attestor | `POST /status` — `{seal_id, status, error_detail, agent_seal_signature}` |
| GetAgentIdBySealId | Blockchain svc | `GET /agents/by-seal-id/{sealId}` |
| GetIntelligentDatas | Blockchain svc | `GET /agents/{agentId}/intelligent-datas` |
| GetAgentMetadata | Blockchain svc | `GET /agents/{agentId}/metadata` |
| GetSealedKeys | Direct Ethereum RPC | `ethclient.FilterLogs(ctx, FilterQuery{Topics: [ITransferred.ID, nil, nil, tokenIdHash]})` |
| FetchConfig | 0G Storage | `GET /config/{hash}` |
| DownloadFile | 0G Storage | `GET /file/{hash}` |

**Signing primitives** (`internal/sealed/state.go`):
- `Sign(data []byte) []byte` — ECDSA P-256, SHA-256 hash, returns R+S (64 bytes)
- `SignWithAgentSealKey(data []byte) []byte` — secp256k1 (go-ethereum), Keccak256 hash, returns R+S (64 bytes, strips V)
- `VerifySignatureWithAgentSealKey(data, signature []byte) bool`

**Response signature content** (`internal/proxy/proxy.go:169`):
```go
content := fmt.Sprintf("%s|%s|%d|%s",
    agentID, sealID, timestamp, hex.EncodeToString(sha256(responseBody)),
)
signature = secp256k1.Sign(keccak256(content))
```

Response headers added to every proxied response:
- `X-Agent-Id` — agent identifier
- `X-Seal-Id` — seal identifier
- `X-Signature` — hex R+S (64 bytes)
- `X-Timestamp` — Unix timestamp

### What we reuse vs. reinvent

**Reuse directly:**
- The signature scheme: `agentId|sealId|timestamp|sha256(body)` → keccak256 → secp256k1 → R+S hex
- `SignWithAgentSealKey()` function verbatim
- The `IntelligentData` struct as the off-chain data pointer
- The `ITransferred` event ABI for sealed key recovery
- The `Status` FSM pattern for lifecycle tracking

**Extend/wrap:**
- The proxy — we want to intercept BEFORE forwarding to capture what the agent does, not just sign the output
- The `IntelligentData` — we'll use it to point to our execution log entries in 0G Storage
- The blockchain client's log scanning — useful pattern for reading back execution events

**Reinvent (wrapper doesn't have):**
- Append-only log structure in 0G Storage
- Session-level anchor on-chain (session start/stop events)
- Per-inference-request logging (wrapper signs responses but doesn't log them to persistent storage)
- Model provenance in signatures (no model hash captured currently)

### Critical gaps / gotchas

1. **No execution logging to persistent storage.** The wrapper signs responses but does NOT write them anywhere — they vanish. Our wedge needs to add this layer.
2. **Demo mode skips all external calls** — useful for local testing. `DEMO_MODE=true` env var activates it.
3. **`IMAGE_HASH` env var** — must be set by the TEE runtime for production attestation. In dev, a placeholder is used.
4. **Legacy vs. current API:** Two attestor endpoints coexist: `/v1/unseal` (legacy) and `/provision` (current). The wrapper uses `/provision`. Keep this in mind when talking to the attestor.
5. **AES-256-GCM format:** nonce is first 12 bytes, tag is last 16 bytes. `len(ciphertext) < 12+16` = error.
6. **The `ITransferred` event scan** does a backward chunk-scan (5000 blocks at a time). For a fresh deployment on testnet this is fine, but at scale could be slow.
7. **A2A endpoints** (`/a2a/hello`, `/a2a/info`) are reserved in the proxy's internal path filter — but not implemented. Potential future hook point.

---

## 2. 0g-agent-nft (ERC-7857 iNFT)

**Repo:** `github.com/0gfoundation/0g-agent-nft`  
**State:** Mature, last pushed Apr 9 2026. Full production contract suite with TEE verifier, beacon proxy upgradeability, marketplace, and test coverage.

### Contract architecture

```
AgentNFT
  ├── ERC7857Upgradeable (base)
  │   ├── ERC721Upgradeable (OpenZeppelin)
  │   └── ERC7857IDataStorageUpgradeable (storage extension)
  ├── ERC7857CloneableUpgradeable (iCloneFrom extension)
  ├── ERC7857AuthorizeUpgradeable (authorizeUsage extension)
  ├── AccessControlUpgradeable
  ├── ReentrancyGuardUpgradeable
  └── PausableUpgradeable

TEEVerifier
  ├── AccessControlUpgradeable
  └── PausableUpgradeable

AgentMarket (marketplace, fee distribution)
```

Deployment uses **BeaconProxy** pattern for upgradability. Tags: `agentNFT`, `verifier`, `teeVerifier`, `agentMarket`.

### On-chain data shape (fields per agent)

**IntelligentData struct** (`contracts/interfaces/IERC7857Metadata.sol`):
```solidity
struct IntelligentData {
    string dataDescription;  // human-readable label (e.g. "model-config-v2")
    bytes32 dataHash;        // 0G Storage key (content hash)
}
```

Per-token storage (`ERC7857IDataStorageUpgradeable`):
```solidity
mapping(uint tokenId => IntelligentData[]) iDatas;
```

Each token can have an **array** of IntelligentData entries — multiple blobs can be attached to one agent.

**ERC7857Storage** (base contract):
```solidity
struct ERC7857Storage {
    mapping(address owner => address) accessAssistants;  // owner → delegate
    IERC7857DataVerifier verifier;                       // TEE/ZKP verifier contract
}
```

**AgentNFTStorage**:
```solidity
struct AgentNFTStorage {
    string storageInfo;                      // JSON: {chainURL, indexerURL}
    address admin;
    uint256 mintFee;
    string baseURI;
    mapping(uint256 => string) customURIs;
    mapping(uint256 => address) creators;    // creator/partner for fee distribution
}
```

### ERC-7857 vs plain ERC-721

ERC-7857 adds on top of ERC-721:
1. **IntelligentData array** per token — each entry is `(description, storageHash)` pointing to encrypted blobs
2. **`iTransferFrom(from, to, tokenId, proofs[])`** — privacy-preserving transfer that requires cryptographic proofs of data re-encryption before ownership moves
3. **`delegateAccess(assistant)`** — owner can delegate a hot wallet to sign proofs on their behalf
4. **`verifier`** contract — pluggable TEE or ZKP oracle that validates `TransferValidityProof[]`

### TransferValidityProof structures

```solidity
struct AccessProof {
    bytes32 dataHash;
    bytes targetPubkey;   // receiver's public key (empty = use receiver's ETH pubkey)
    bytes nonce;
    bytes proof;          // TEE or ZKP signature
}

struct OwnershipProof {
    OracleType oracleType;  // TEE or ZKP
    bytes32 dataHash;
    bytes sealedKey;        // data key re-encrypted for the new owner (ECIES)
    bytes targetPubkey;
    bytes nonce;
    bytes proof;
}

struct TransferValidityProof {
    AccessProof accessProof;
    OwnershipProof ownershipProof;
}
```

The `sealedKey` inside `OwnershipProof` is the per-data encryption key, ECIES-sealed for the new owner's public key. This is what gets emitted in the `ITransferred` event and scanned by the agent-wrapper blockchain client.

### Lifecycle events / anchoring potential

**Key events emitted:**

| Event | Signature | Anchoring use |
|-------|-----------|---------------|
| `Transfer(from, to, tokenId)` | ERC-721 standard | Token ownership change |
| `Updated(tokenId, oldDatas, newDatas)` | `event Updated(uint256 indexed _tokenId, IntelligentData[] _oldDatas, IntelligentData[] _newDatas)` | Data update on token |
| `PublishedSealedKey(to, tokenId, sealedKeys)` | `event PublishedSealedKey(address indexed _to, uint256 indexed _tokenId, bytes[] _sealedKeys)` | Sealed key delivery on transfer |
| `DelegateAccess(user, assistant)` | `event DelegateAccess(address indexed _user, address indexed _assistant)` | Delegation change |

**Most useful for our wedge:** `Updated` event — every time the agent updates its IntelligentData (e.g., pointing to a new execution log batch), this event is emitted with the old and new data hashes. This is a natural per-session anchor.

**TEEVerifier** (`contracts/TeeVerifier.sol`):
```solidity
function verifyTEESignature(bytes32 dataHash, bytes calldata signature) external view returns (bool)
```
Checks that `signature` was produced by the registered `teeOracleAddress`. We can use this to anchor execution log hashes on-chain verified by the TEE's signing key.

### What we reuse vs. reinvent

**Reuse:**
- `IntelligentData` struct as our log pointer on-chain
- `Updated` event — emit it each time we write a new session log batch
- `update(tokenId, newDatas)` function — owner calls this to point the agent's token to the new log hash
- `TEEVerifier.verifyTEESignature()` — anchor our log hash signed by the agent's TEE key
- Beacon proxy pattern — if we deploy our own ExecutionLog contract

**Don't reinvent:**
- The ERC-7857 transfer/proof system — we're adding an execution log, not changing ownership mechanics
- The TEE verifier infrastructure — it already exists and validates TEE-signed data

### Critical gaps / gotchas

1. **No native "session" or "execution run" concept in ERC-7857.** The standard only knows IntelligentData blobs. We must use `dataDescription` as a convention (e.g., `"execution-log-session-{sessionId}"`) to distinguish our log entries from agent config blobs.
2. **`update(tokenId, newDatas)` wipes old data** — `_updateData` deletes the old array and replaces entirely. If we're appending new log entries, we must pass the full array (old + new) or maintain a separate contract.
3. **Max authorized users = 100 per token** — not relevant for our wedge but good to know.
4. **Networks:** Testnet = chain ID 16602 (0G Galileo, RPC: `https://evmrpc-testnet.0g.ai`). Mainnet = chain ID 16661. The agent-market deploy scripts reference `ZG_TESTNET_RPC_URL` and `ZG_MAINNET_RPC_URL`.
5. **Deployment order dependency:** `verifier` must deploy before `agentNFT`. TEE verifier needs the `teeOracleAddress` (the signing key's address) at init time.

---

## 3. agenticID-examples (ERC-8004 Agent ID)

**Repo:** `github.com/0gfoundation/agenticID-examples`  
**State:** Three self-contained examples, last pushed Apr 4 2026. These are educational/demo — they use simplified contracts without TEE/ZKP proof verification (proofs are accepted as dummy inputs).

> **Critical note:** The README uses "ERC-8004" in the title and context, but the actual contract interface is called `IERC7857` throughout — there is no separate ERC-8004 interface file in this repo. ERC-7857 *is* the "Agentic ID" standard here. The examples show ERC-7857 usage with the authorization and cloneable extensions.

### Identity registration flow

**End-to-end from "I have an agent" to "it has an on-chain identity":**

1. Deploy `AgenticID.sol` (or use the pre-deployed on Galileo: `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F`, chain ID 16602)
2. Prepare `IntelligentData[]` — array of `{dataDescription, dataHash}` structs describing the agent:
   ```ts
   const agentData = [
     { dataDescription: "model-weights-codellama-34b",
       dataHash: ethers.keccak256(ethers.toUtf8Bytes("model-content-hash")) },
     { dataDescription: "system-prompt",
       dataHash: ethers.keccak256(ethers.toUtf8Bytes("prompt-content")) },
   ]
   ```
3. Call `iMint(to, datas)` (payable, requires `mintFee`):
   ```ts
   const tx = await agenticId.connect(alice).iMint(alice.address, agentData, { value: MINT_FEE });
   ```
   Emits `IntelligentDataSet(tokenId, datas)` + ERC-721 `Transfer`.
4. The returned `tokenId` is the on-chain agent identity.

### Key function signatures

**Minting:**
```solidity
function iMint(address to, IntelligentData[] calldata datas) external payable returns (uint256 tokenId)
function iMintWithRole(address to, IntelligentData[] calldata datas, address creator) external returns (uint256)
function mint(address to) external payable returns (uint256)     // standard NFT (no data)
function mintWithRole(address to) external returns (uint256)
```

**Intelligent data:**
```solidity
function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory)
```

**Authorization:**
```solidity
function authorizeUsage(uint256 tokenId, address user) external
function revokeAuthorization(uint256 tokenId, address user) external
function batchAuthorizeUsage(uint256[] calldata tokenIds, address user) external
function isAuthorizedUser(uint256 tokenId, address user) external view returns (bool)
function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory)
function authorizedTokensOf(address user) external view returns (uint256[] memory)
```

**Delegation:**
```solidity
function delegateAccess(address assistant) external
function revokeDelegateAccess() external
mapping(address => address) public delegatedAssistant
```

**Transfer (intelligent):**
```solidity
function iTransferFrom(address from, address to, uint256 tokenId, TransferValidityProof[] calldata) external
function iCloneFrom(address from, address to, uint256 tokenId, TransferValidityProof[] calldata) external returns (uint256 newTokenId)
```

**Events:**
```solidity
event IntelligentDataSet(uint256 indexed tokenId, IntelligentData[] data)
event IntelligentTransfer(address from, address to, uint256 tokenId)
event IntelligentClone(address from, address to, uint256 sourceId, uint256 newTokenId)
event UsageAuthorized(uint256 tokenId, address user)
event UsageRevoked(uint256 tokenId, address user)
event DelegateAccessSet(address indexed owner, address indexed assistant)
```

### Fields / metadata available per agent

Per the example scripts, the IntelligentData entries serve as the agent's "resume":
- Model identifier / weights hash (e.g., `"model-weights-codellama-34b"`)
- System prompt hash (e.g., `"system-prompt-coding"`)
- Tools manifest hash (e.g., `"tools-manifest"`)
- Style/config hash

All are `bytes32` hashes — the actual content lives in 0G Storage (or IPFS), the on-chain entry is just the `(description, hash)` pointer. For our execution log, we'd add entries like:
```ts
{ dataDescription: "execution-log-session-abc123", dataHash: logBatchHash }
```

### Relationship to ERC-7857

ERC-7857 IS the "Agentic ID" standard — the examples explicitly say: "Agentic ID is an on-chain identity standard for AI agents. It extends ERC-721 with encrypted intelligent data." There is no separate ERC-8004 contract in this repo. The naming in the hackathon description ("ERC-8004") appears to refer to ERC-7857 (sometimes also called iNFT standard in 0G's docs).

The architecture comment in `agent-wrapper/docs/architecture.md` says: `"Agent Metadata (ERC-7857 + ERC-8004 + Agentic)"` — suggesting these may be layered or synonymous in their ecosystem.

**Bottom line:** Build to ERC-7857. The `AgenticID.sol` contract is the correct implementation target.

### What we reuse vs. reinvent

**Reuse directly:**
- `AgenticID.sol` or the pre-deployed contract on Galileo testnet (`0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F`) — no need to redeploy
- `iMint(to, datas)` to register our OpenClaw agent on-chain with initial IntelligentData
- `authorizeUsage(tokenId, observer)` to grant read-access to our execution log verifier
- `getIntelligentDatas(tokenId)` as the query path for verifiers to find log pointers

**Add on top:**
- Convention: use `dataDescription` prefix `"execution-log-"` to distinguish log entries from config entries
- Periodic `update()` calls (on AgentNFT) or multiple `iMint()` tokens (on AgenticID) to publish new log batches

### Critical gaps / gotchas

1. **The simplified `AgenticID.sol` in examples skips TEE/ZKP proof verification** — proofs are accepted as empty/dummy. Production use must use `0g-agent-nft` with the real `TEEVerifier`.
2. **No `update()` function in the simplified `AgenticID.sol`** — the examples contract doesn't expose a public data update. Only `iMint` sets data. For log append, we'd need to either: (a) use the production `AgentNFT.update(tokenId, newDatas)`, or (b) mint a new token per session.
3. **`iTransferFrom` clears all authorizations** — if we transfer the agent NFT, any granted log verifiers lose access. This is correct behavior but must be documented.
4. **`iCloneFrom` copies IntelligentData but NOT authorizations** — clones start fresh.
5. **Max 100 authorized users per token** — for a public verifier registry this might be tight; keep in mind.
6. **Network:** 0G Galileo Testnet, chain ID 16602, RPC `https://evmrpc-testnet.0g.ai`. Get tokens at `https://faucet.0g.ai`.

---

## Cross-cutting findings

### Recommended integration sequence

Stack in this order:

**Layer 0 — Identity (exists, reuse):**
Register the OpenClaw agent as an AgenticID token on 0G Galileo testnet using `iMint()`. This gives us the `tokenId` that identifies the agent.

**Layer 1 — TEE Execution Context (extend agent-wrapper):**
At session start, generate a `sessionId = keccak256(agentId + timestamp + nonce)`. At each tool call / inference request, append a structured log entry:
```json
{
  "sessionId": "0x...",
  "seq": 1,
  "ts": 1746123456,
  "type": "tool_call",
  "tool": "web_search",
  "modelHash": "sha256:claude-sonnet-4-6",
  "inputHash": "sha256:...",
  "outputHash": "sha256:...",
  "agentId": "0x...",
  "sealId": "0x..."
}
```
Sign each entry with `SignWithAgentSealKey()` (already in `internal/sealed/state.go`).

**Layer 2 — Persistent log in 0G Storage (new):**
At session end, flush the signed log entries as a JSON array to 0G Storage. Get back a content hash (`bytes32`). This is the `dataHash` for the IntelligentData entry.

**Layer 3 — On-chain anchor (extend AgentNFT/AgenticID):**
Call `update(tokenId, [{description: "execution-log-{sessionId}", dataHash: logHash}])` (or `iMint` for a new session token). The `Updated(tokenId, oldDatas, newDatas)` event serves as the on-chain timestamp proof. If we can call `TEEVerifier.verifyTEESignature(logHash, teeSignature)`, the anchor is cryptographically tied to the TEE.

**Layer 4 — Verification path (new UI/API):**
Any observer queries:
1. `intelligentDatasOf(tokenId)` → find log entries by `dataDescription` prefix
2. Download log from 0G Storage by `dataHash`
3. Verify each entry's signature against the agent's known `agentSealKey` public key
4. Optionally call `TEEVerifier.verifyTEESignature(logHash, sig)` to confirm TEE origin

### What already exists that we MUST NOT reinvent

| Component | Location | Status |
|-----------|----------|--------|
| `SignWithAgentSealKey()` | `agent-wrapper/internal/sealed/state.go:420` | **Use verbatim** |
| `IntelligentData` struct | Both repos | **Use as-is** |
| 0G Storage download | `agent-wrapper/internal/storage/storage.go` | **Extend, don't replace** |
| ITransferred ABI + log scanner | `agent-wrapper/internal/blockchain/client.go:315` | **Reference pattern** |
| `TEEVerifier.verifyTEESignature()` | `0g-agent-nft/contracts/TeeVerifier.sol:78` | **Hook into for on-chain anchor** |
| ERC-7857 `Updated` event | `0g-agent-nft/contracts/interfaces/IERC7857.sol:21` | **Use as session anchor event** |
| AgenticID pre-deployed contract | Galileo: `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` | **Use directly, no redeploy** |
| Attestor provision flow | `agent-wrapper/internal/attest/client.go:312` | **Don't replicate** |
| ECIES sealed key decrypt | `agent-wrapper/internal/attest/client.go:274` | **Don't replicate** |

### Open questions — resolved

**Q1. Upload path to 0G Storage** *(research needed — see below)*  
→ PENDING research agent output.

**Q2. TEE oracle address** *(research needed — see below)*  
→ PENDING research agent output.

**Q3. Log storage format** ✅ DECIDED  
→ **Session-flush.** One consolidated JSON blob written to 0G Storage at session end. No mid-session storage writes. Crash mitigation: write a minimal "session-started" checkpoint at session start (cheap), full log written at end. Acceptable for hackathon; document crash-loss as known limitation.

**Q4. `update()` vs. new token per session** ✅ DECIDED  
→ **One AgenticID token per session via `iMint()`.** No state accumulation. Each session is fully self-contained — mint one NFT, attach one `IntelligentData` entry pointing to that session's log blob in 0G Storage. Clean audit trail, no need to track prior log hashes. Works against the pre-deployed `AgenticID.sol` at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` (Galileo, chain 16602).

**Q5. Model hash / model identity** ✅ DECIDED  
→ **Two-field composite stored in the log JSON body:**
  - `containerHash`: `IMAGE_HASH` env var (TEE-attested container, available at runtime)
  - `modelId`: LLM string identifier (e.g. `"claude-sonnet-4-6"`, sourced from `session_status`)
  
  The on-chain `dataDescription` will be `"exec-log:<sessionId>:<modelId>"` for human readability. Both fields are included in the TEE-signed content so they can't be tampered post-hoc.

**Q6. Session definition** ✅ DECIDED  
→ **One OpenClaw conversation session = one execution anchor.** Session ID sourced from OpenClaw runtime (`mcp__openclaw__session_status`). This is the natural unit of work — coarser than per-tool-call (too many transactions), finer than per-day (too coarse for provenance). One session → one 0G Storage blob → one NFT mint.

**Q7. Gas cost estimation** *(research needed — see below)*  
→ PENDING research agent output.

**Q8. Backwards compatibility** ✅ DECIDED  
→ **Sidecar approach — agent-wrapper is untouched.** Our execution logger runs as a standalone service. It reads the proxy's signed response headers (`X-Agent-Id`, `X-Seal-Id`, `X-Signature`, `X-Timestamp`) that the wrapper already adds to every response. The logger:
  1. Intercepts those headers (either as an outer proxy layer or via log line parsing)
  2. Accumulates the session trace
  3. At session end: writes JSON blob to 0G Storage, calls `iMint()` on-chain
  
  Project is entirely additive — zero changes to agent-wrapper. This is the correct architecture for a hackathon where the wrapper repo is upstream code we don't own.
