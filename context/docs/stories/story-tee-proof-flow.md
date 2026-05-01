# Story: tee-proof-flow

**Epic:** Epic 2 — TEE Proof Adapter  
**Estimated time:** ~1.5h  
**Dependencies:** story-tee-header-parser, story-tee-verifier-contract

---

## Narrative

As a TEE adapter developer, I need to verify that a ZG-Res-Key header contains a valid ECDSA signature by calling the MockTEEVerifier contract.

---

## Acceptance criteria

```gherkin
Given TEEProofAdapter is created with constructor(contractAddress: string, provider: ethers.Provider)
And HeaderParser is initialized
When TEEProofAdapter.verify(headerValue: string) is called
Then it:
  1. Parses the header via HeaderParser.parse()
  2. Computes dataHash = keccak256(text)
  3. Calls MockTEEVerifier.verifyTEESignature(dataHash, signature)
  4. Returns { valid: boolean, dataHash: string, signature: string, signingAddress: string }

Given a valid ZG-Res-Key header with ECDSA signature
When verify() is called
Then valid === true (or matches MockTEEVerifier response)

Given a ZG-Res-Key header with invalid signature
When verify() is called
Then valid === false
And an error is NOT thrown (graceful failure)

Given pnpm test is run in packages/tee-adapter
Then all tests pass
```

---

## File modification map

**Create:**
- `packages/tee-adapter/src/TEEProofAdapter.ts` — Class with verify() method
- `packages/tee-adapter/tests/tee-proof-flow.test.ts` — Test valid sig, invalid sig, contract call, edge cases

**Update:**
- `packages/tee-adapter/src/index.ts` — Export TEEProofAdapter, verify result type

---

## Shell verification

```bash
pnpm --filter=tee-adapter vitest run tee-proof-flow.test.ts
# Must exit 0
```
