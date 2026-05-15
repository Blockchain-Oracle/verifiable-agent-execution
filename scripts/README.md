# scripts/ — utility scripts

Top-level scripts run via `pnpm exec tsx scripts/<name>.ts` (or
directly as bash, for `install.sh`). Each one is small, focused,
and re-runnable.

## Layout

```
scripts/
├── smoke/                  Re-runnable live-testnet smoke tests
│   ├── agenticid.ts          Calls AgenticID.getIntelligentDatas() against Galileo
│   ├── storage.ts            Round-trip upload + download to 0G Storage
│   ├── tee-headers.ts        Validates the TEE signing-message byte layout
│   ├── signed-anchor.ts      End-to-end: sign → encrypt → upload → mint
│   ├── per-entry-verify.ts   Verifies each tool-call entry's signature
│   ├── verify-token.ts       Resolves /verify/<tokenId> server-side
│   ├── defi-swap-demo.ts     Generates the canonical DeFi-swap demo session
│   └── defi-swap-demo-with-compute.ts  Same, plus a 0G Compute TeeML call
│
├── lib/
│   └── network.ts          Shared network-config helper (RPC, indexer URLs)
│
├── capture-anchor.ts       Playwright — snapshot anchor screenshots (Trigger.dev style)
├── init-wallet.ts          Generate the plugin's signing wallet on first install
└── install.sh              One-shot installer: clone → bundle → link plugin into OpenClaw
```

## Smoke tests — the spec's proof of life

Three of these (`agenticid.ts`, `storage.ts`, `tee-headers.ts`) are
the canonical proof that our code can actually talk to the network.
They run against real Galileo testnet. If they pass, the SDK shapes
in our types match reality.

```bash
# Run a smoke test
pnpm exec tsx scripts/smoke/agenticid.ts

# Run all three "lock the SDK shape" smokes
pnpm exec tsx scripts/smoke/agenticid.ts && \
pnpm exec tsx scripts/smoke/storage.ts && \
pnpm exec tsx scripts/smoke/tee-headers.ts
```

The `defi-swap-demo*.ts` scripts are heavier — they generate full
canonical demo sessions on testnet/mainnet (mint included). They're
how we produced `tokenId 0` on each chain.

## install.sh

The end-to-end clone-based installer for the plugin. Builds the
self-contained bundle and `openclaw plugins install --link`s it
into your local OpenClaw.

```bash
git clone https://github.com/Blockchain-Oracle/verifiable-agent-execution
cd verifiable-agent-execution
./install.sh
openclaw gateway restart
```

Defaults to Galileo testnet. Override per-chain via env vars
documented at the top of the script.

## capture-anchor.ts

Playwright script that loads a URL (e.g. trigger.dev) and saves
viewport screenshots into `screenshots/anchor/`. We use this for
the UX-spec immutable anchor captures.
