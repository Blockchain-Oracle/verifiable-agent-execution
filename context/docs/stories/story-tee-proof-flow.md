# Story: tee-proof-flow

**Epic:** Epic 2 — TEE Proof Adapter
**Estimated time:** ~1.5h
**Dependencies:** story-tee-header-parser, story-tee-verifier-contract

---

## Narrative

As a TEE adapter developer, I need a `TEEProofAdapter` that takes a parsed `AgentWrapperAttestation` plus the response body, reconstructs the exact message agent-wrapper signed, computes its `keccak256` digest, and submits `(dataHash, signature)` to `TEEVerifier.verifyTEESignature(bytes32, bytes)` on Galileo so each tool-call entry has a chain-checkable proof.

**Source of truth:**
- Signing message format: `0gfoundation/agent-wrapper/docs/api.md` §"Signature Format" — `Sign(sealId + "|" + ...)`
- On-chain verifier: `0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol` — `verifyTEESignature(bytes32 dataHash, bytes calldata signature) external view returns (bool)`; requires `signature.length == 65`; recovers signer via OZ `ECDSA.recover` and compares to `teeOracleAddress`.
- Default oracle (testnet): `0x04581d192d22510ced643eaced12ef169644811a` (hardcoded in `0g-agent-nft/scripts/deploy/deploy_tee.ts`).

---

## Acceptance criteria

```gherkin
Given TEEProofAdapter is constructed with:
  - verifierAddress: string  (deployed MockTEEVerifier on Galileo)
  - provider: ethers.Provider (Galileo)
And HeaderParser is initialized

When TEEProofAdapter.verify(attestation: AgentWrapperAttestation, body: string) is called
Then the adapter:
  1. Reconstructs the signing message exactly as agent-wrapper does
     (format documented at agent-wrapper/docs/api.md §"Signature Format")
  2. Computes dataHash = keccak256(toUtf8Bytes(signingMessage))
  3. Calls verifier.verifyTEESignature(dataHash, getBytes(attestation.signature))
  4. Returns { valid: boolean, dataHash: string, recoveredSigner: string }

Given a fixture attestation produced by the testnet TEE oracle (0x04581d…)
When verify() is called
Then valid === true
And recoveredSigner === '0x04581d192d22510ced643eaced12ef169644811a' (case-insensitive)

Given an attestation whose signature was tampered (last byte flipped)
When verify() is called
Then valid === false
And no exception is thrown (graceful failure, returns the result object)

Given the verifier contract address is malformed or the contract reverts
When verify() is called
Then a typed VerifierCallError is thrown so the SessionLogger can mark the entry as 'verifier_unreachable'

Given pnpm test is run in packages/tee-adapter
Then ≥6 tests pass covering: happy path, tampered sig, missing oracle role,
unreachable verifier, signature length != 65, message-reconstruction edge cases
```

---

## File modification map

**Create:**
- `packages/tee-adapter/src/TEEProofAdapter.ts` — class with `verify()` method
- `packages/tee-adapter/src/signing-message.ts` — pure function `reconstructSigningMessage(attestation, body)` matching agent-wrapper/docs/api.md
- `packages/tee-adapter/tests/tee-proof-flow.test.ts` — covers all acceptance scenarios
- `packages/tee-adapter/tests/fixtures/agent-wrapper-attestation.json` — captured from a real testnet response

**Update:**
- `packages/tee-adapter/src/index.ts` — export TEEProofAdapter, VerifierCallError

---

## Shell verification

```bash
# Set env:
export ZG_TESTNET_RPC="https://evmrpc-testnet.0g.ai"
export TEE_VERIFIER_ADDRESS="<deployed MockTEEVerifier on Galileo>"

pnpm --filter=tee-adapter vitest run tee-proof-flow.test.ts
# Must exit 0
```

---

## Notes for the coding agent

- **Do not** treat `ZG-Res-Key` as a JSON envelope. That header carries a `chatID` string for off-chain `processResponse(provider, chatID)` verification, not a raw signature. It is the *fallback* path in ADR-07, not this story.
- The signing message format MUST be re-read from `agent-wrapper/docs/api.md` at implementation time — fetch via the `gh api` raw endpoint, not from training memory. `keccak256` over a slightly wrong message → silent `valid=false`.
- For local CI, mock the verifier with a contract that returns `true` for any 65-byte signature (matches `MockTEEVerifier.sol`); for the e2e smoke run, point `TEE_VERIFIER_ADDRESS` at the real deployed verifier.
