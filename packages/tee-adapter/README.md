# @verifiable-agent-execution/tee-adapter

TEE signing-message helpers + the ABI of our deployed
`MockTEEVerifier` contract.

## What's in here

| Module | What it does |
|---|---|
| `signing-message` | Canonical byte layout for the per-tool-call signing input. Producer (plugin) and verifier (contract + dashboard) MUST agree on this layout; this package is the single source of truth. |
| `MockTEEVerifier` ABI | TypeChain-style typed contract interface so the dashboard can `verifyTEESignature(...)` from the browser via ethers v6. |

## "TEE-rooted, not trustless"

The signing key is generated inside the agent's TEE container (Intel
TDX / SGX). The signature proves the entry came from inside an
attested TEE — not that the operator is honest. See
[`apps/docs/src/content/concepts.mdx`](../../apps/docs/src/content/concepts.mdx)
for the full trust model and
[`contracts/contracts/MockTEEVerifier.sol`](../../contracts/contracts/MockTEEVerifier.sol)
for the deployed verifier.

## Used by

- `plugin/` — signs every tool-call entry before adding it to the
  session log.
- `apps/dashboard/` — verifies signatures client-side via the
  MockTEEVerifier contract on 0G.
