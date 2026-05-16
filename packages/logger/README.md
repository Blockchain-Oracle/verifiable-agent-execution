# @verifiable-agent-execution/logger

Session-log capture + encryption + 0G Storage upload. The
producer-side counterpart to the dashboard's verify route.

## What's in here

| Module | What it does |
|---|---|
| `SessionLogger` | Buffers signed tool-call entries in memory keyed by `sessionId`. Flushed at session_end. |
| `crypto` | AES-256-GCM envelope: encrypts the session log with a per-receipt key. Wire format is shared with `plugin/src/crypto.ts` (the producer) and `apps/dashboard/src/lib/crypto.ts` (the consumer). |
| 0G Storage upload | Uploads the encrypted blob via `@0gfoundation/0g-storage-ts-sdk`; returns the rootHash that anchors the receipt on-chain. |

## Used by

- `plugin/` — every OpenClaw session creates a SessionLogger,
  buffers tool calls, then flushes to 0G Storage on `session_end`.

## Stack

- `@0gfoundation/0g-storage-ts-sdk` ^1.2.8
- ethers ~6.13.1 (for keccak256, hex utilities)
- WebCrypto (browser-compatible AES-256-GCM)
