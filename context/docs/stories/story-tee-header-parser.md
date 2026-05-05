# Story: tee-header-parser

**Epic:** Epic 2 — TEE Proof Adapter
**Estimated time:** ~1h
**Dependencies:** None

---

## Narrative

As a TEE adapter developer, I need to parse the four signature headers that `0gfoundation/agent-wrapper` adds to every proxied response, exposing them as a typed `AgentWrapperAttestation` so downstream code can reconstruct the signing message and call `TEEVerifier.verifyTEESignature(bytes32, bytes)`.

**Why these headers (not `ZG-Res-Key`):** `ZG-Res-Key` carries a `chatID` string, not a raw signature; it is verified off-chain via `broker.inference.processResponse(providerAddress, chatID)` and never exposes a `(bytes32, bytes)` pair we can put on chain. `agent-wrapper` writes inline ECDSA headers shaped exactly for the contract verifier — that is the primary proof source for our anchored audit trail (see ADR-07 in `docs/architecture.md`).

**Source of truth:**
- Header writes: `0gfoundation/agent-wrapper/internal/proxy/proxy.go` — `w.Header().Set(...)` for `X-Agent-Id`, `X-Seal-Id`, `X-Signature`, `X-Timestamp`
- Header semantics: `0gfoundation/agent-wrapper/docs/api.md` §"Signature Format"

---

## Acceptance criteria

```gherkin
Given an HTTP response with the four agent-wrapper headers set:
  X-Agent-Id:  0x1234567890abcdef1234567890abcdef12345678
  X-Seal-Id:   0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
  X-Signature: 1a2b3c4d5e6f...   (128 hex chars, no 0x prefix per agent-wrapper convention)
  X-Timestamp: 1712787654
When HeaderParser.parse(headers: Headers): AgentWrapperAttestation is called
Then it returns:
  {
    agentId:   string,    // hex-prefixed
    sealId:    string,    // hex-prefixed
    signature: string,    // 0x-prefixed (parser normalizes), 132 hex chars total
    timestamp: number     // Unix seconds
  }
And the parsed signature is exactly 65 bytes when hex-decoded (matches TEEVerifier require)

Given a response with one of the four headers missing
When HeaderParser.parse() is called
Then it throws AgentWrapperHeaderMissingError naming the missing header

Given X-Signature whose hex-decoded length is not 65
When HeaderParser.parse() is called
Then it throws AgentWrapperSignatureLengthError

Given X-Timestamp that is not a base-10 unsigned integer
When HeaderParser.parse() is called
Then it throws AgentWrapperTimestampFormatError
```

---

## File modification map

**Create:**
- `packages/tee-adapter/src/HeaderParser.ts` — `parse(headers: Headers)` with Zod schema; normalizes signature to `0x`-prefixed
- `packages/tee-adapter/src/types.ts` — `AgentWrapperAttestation` type + error classes
- `packages/tee-adapter/tests/header-parser.test.ts` — fixtures for: all-four-present, each-one-missing (×4), wrong sig length, wrong timestamp format, lowercase variants

**Update:**
- `packages/tee-adapter/src/index.ts` — export `HeaderParser`, `AgentWrapperAttestation`, error classes

---

## Shell verification

```bash
pnpm --filter=tee-adapter vitest run header-parser.test.ts
# Must exit 0, expect ≥7 tests
```

---

## Notes for the coding agent

- **Do not** parse `ZG-Res-Key`. If a fallback is ever needed, it is a separate adapter (`processResponse(provider, chatID)`) and lives in a different file.
- The signature on the wire is hex without `0x` per agent-wrapper convention. Normalize to `0x`-prefixed inside the parser so downstream `ethers.getBytes(sig)` works.
- `X-Seal-Id` is 64 hex chars (32 bytes), `X-Signature` is 130 hex chars (65 bytes incl. `v`). Validate both lengths.
