# @verifiable-agent-execution/chain-client

On-chain client wrappers for AgenticID (the ERC-7857 iNFT contract)
and the SessionAnchor flow that mints a receipt iNFT.

## What's in here

| Module | What it does |
|---|---|
| `AgenticIDClient` | Read + mint helpers around `AgenticID.sol`. Wraps ethers v6 contract calls. |
| `SessionAnchor` | One-call mint of a session receipt — accepts the encrypted blob, computes the rootHash, uploads to 0G Storage, mints the iNFT. |

## Used by

- `plugin/` — the OpenClaw plugin imports SessionAnchor to mint
  every session's receipt at `session_end`.
- `apps/dashboard/` — the verifier UI reads from AgenticID to
  resolve `/verify/<tokenId>` URLs.

## Stack

- ethers ~6.13.1 (strict — pinned by `@0gfoundation/0g-storage-ts-sdk`'s peer dep)
- TypeScript strict
- No build step — Next.js transpiles raw .ts via `transpilePackages`,
  and esbuild inlines this package into the plugin's npm bundle.
