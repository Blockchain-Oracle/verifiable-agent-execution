/**
 * verifiable-execution — OpenClaw plugin entry.
 *
 * Closes Epic 4 (stories: skill-init, skill-intercept, skill-close).
 * Captures every tool call inside an agent session, flushes the log to
 * 0G Storage at session end, and mints an AgenticID iNFT anchoring the
 * rootHash on-chain. Produces a `<verifyUrlBase>/verify/<tokenId>` URL
 * the verifier dashboard can resolve cold. The network (testnet vs
 * mainnet) is disambiguated by the configured verifyUrlBase domain
 * (Epic-7 subdomain split: `verifiable.0g.ai` = testnet root,
 * `mainnet.verifiable.0g.ai` = mainnet subdomain) — NOT by a chainId
 * segment in the path. Same model Etherscan uses vs Sepolia.Etherscan.
 *
 * Hooks fire AUTOMATICALLY — every tool call across every channel
 * (Telegram/Discord/Slack/CLI), every session end. The AI is observed
 * from outside its decision loop, never asked to cooperate. This is
 * the wedge: judges download a verifiable-claw demo distro, use it
 * normally, every action gets anchored with zero AI awareness required.
 *
 * Source of truth (verified by reading SDK + reference plugin):
 *   - Reference plugin: 0g-memory/openclaw-skills/evermemos/ (cloned to
 *     /tmp/og-refs/ during the outwards audit). Default export is an
 *     OBJECT with {id, name, description, register} — NOT a function.
 *   - OpenClawPluginApi.on signature: openclaw@2026.5.4
 *     dist/plugin-sdk/src/plugins/types.d.ts:2052 — typed lifecycle hook
 *     entry. Per-hook (event, ctx) types come from PluginHookHandlerMap[K].
 *   - Hook event names + payloads: same package's hook-types.d.ts.
 *     `after_tool_call` → (PluginHookAfterToolCallEvent, PluginHookToolContext).
 *     `session_end` → (PluginHookSessionEndEvent, PluginHookSessionContext).
 *
 * containerHash strategy (note for reviewer):
 *   The session-mint BDD (story-session-mint.md) says containerHash is
 *   "the OpenClaw container hash captured at session end". OpenClaw
 *   doesn't expose a hardware-attested TEE container hash today, so we
 *   derive a deterministic synthetic:
 *     containerHash = sha256("openclaw-session:" + sessionKey + ":" + agentId)
 *   formatted as 0x-prefixed bytes32. This is sufficient for the
 *   AgenticID anchor (which doesn't cryptographically validate
 *   containerHash semantics — that's Epic 5 verifier scope), and lets
 *   any third party re-derive the hash from public session metadata.
 *   When OpenClaw exposes a real TEE attestation we swap this synthetic
 *   for the attestation hash, no schema change required (it's the same
 *   bytes32 slot).
 */

import { createHash, randomBytes } from "node:crypto";

import { JsonRpcProvider, Wallet } from "ethers";
import {
  Indexer,
} from "@0gfoundation/0g-storage-ts-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import {
  StorageClient,
  type IndexerLike,
  type SessionLogger,
} from "@verifiable-agent-execution/logger";
import {
  AgenticIDClient,
  SessionAnchor,
  SessionAnchorMintAfterFlushError,
} from "@verifiable-agent-execution/chain-client";

import { resolveConfig, type VerifiableExecutionConfig } from "./config.js";
import {
  encryptSessionLog,
  generateKey,
  keyToShareString,
} from "./crypto.js";
import { sha256Hex } from "./hash.js";
import { Keystore } from "./keystore.js";
import { SessionManager } from "./SessionManager.js";
import { handleShareCommand } from "./share-command.js";
import {
  parseTranscriptToolCalls,
  resolveClaudeCliTranscriptPath,
  type TranscriptToolCall,
} from "./transcript-parser.js";
import { printFirstRunBanner, resolveWallet } from "./wallet.js";

const PLUGIN_ID = "verifiable-execution";
const PLUGIN_NAME = "Verifiable Execution";
const PLUGIN_DESCRIPTION =
  "Anchors every agent session as a TEE-signed log on 0G Storage + iNFT on AgenticID, producing a /verify/<tokenId> URL anyone can verify cold.";

// ---------------------------------------------------------------------------
// Plugin state — built when config + private key both resolve. A
// degraded plugin (missing config OR missing PRIVATE_KEY env) skips
// state construction and registers no-op stubs.
// ---------------------------------------------------------------------------

interface PluginState {
  config: VerifiableExecutionConfig;
  sessions: SessionManager;
  agenticIdClient: AgenticIDClient;
  /**
   * Plugin's signing wallet — used to ECDSA-sign every entry so the
   * dashboard renders "Signed by <agentId>" instead of "Unsigned".
   * The wallet's address == config.agentId (auto-bound at register),
   * so the dashboard verifies `ecrecover(digest, sig) === entry.agentId`
   * without needing MockTEEVerifier's global oracle to match.
   */
  signer: Wallet;
  /**
   * v0.3.0 — per-tokenId encryption key persistence. Holds the AES-256-GCM
   * symmetric key for each minted receipt; powers the `/share` slash-
   * command that returns a `verify/<id>#k=...` URL. The pre-mint
   * (`setPending`) → post-mint (`commitPending`) ordering is what makes
   * crash recovery between flush and mint possible.
   */
  keystore: Keystore;
  /**
   * v0.3.4 — retry registry for UN-flushed SessionLoggers.
   *
   * Keyed by `pendingKeyName` (the compound `${sessionKey}|run:${runId}`),
   * NOT by sessionKey, because the next agent_end on the same
   * sessionKey gets a fresh SessionLogger via `takeAndRelease` and
   * MUST not collide with a previous run still in retry.
   *
   * Scope is intentionally narrow (round-4 finding #1): this registry
   * holds the plaintext logger ONLY between `takeAndRelease` and
   * the moment `flush()` succeeds. Once the encrypted bytes are
   * durable on 0G Storage, the registry entry is deleted — recovery
   * after that point only needs `{rootHash, entryCount, sessionId,
   * dataDescriptionPrefix}` which are surfaced on
   * `SessionAnchorMintAfterFlushError`. Keeping plaintext past flush
   * would be a memory + privacy regression.
   *
   * In practice contains ≤ 1 entry per active sessionKey, and only
   * during the upload window (sub-second on Galileo testnet).
   */
  pendingAnchors: Map<string, SessionLogger>;
  /**
   * v0.3.5 — per-session run metadata used to capture claude-cli
   * (and other transcript-emitting providers') INTERNAL tool calls.
   *
   * Background: claude-cli runs Claude Code as a subprocess. Its
   * built-in tools (Read/WebSearch/Bash/Edit/MCP) don't route through
   * OpenClaw's tool dispatcher, so `after_tool_call` never fires. The
   * tool calls ARE persisted to Claude Code's session jsonl at
   * `~/.claude/projects/<encoded-workspaceDir>/<claude-session-id>.jsonl`
   * — we read that file at `agent_end` time and inject one entry per
   * `tool_use` block (with the paired `tool_result` as its
   * `outputHash` source).
   *
   * Two metadata fields per sessionKey:
   *   - `runStartTime`: set when `message_received` fires; used to
   *     filter jsonl events to "those produced during THIS run". Lets
   *     us re-read the same jsonl across multiple turns without
   *     re-anchoring stale tool entries.
   *   - `transcriptPath`: set when `before_agent_finalize` fires
   *     (the hook OpenClaw's native-hook-relay provides for claude-cli
   *     when its `.claude/settings.json` is configured). Lets us
   *     skip the fallback file-system probe.
   *
   * If `transcriptPath` is missing at `agent_end` (e.g. Claude Code's
   * settings.json hasn't been wired), we fall back to resolving from
   * `ctx.workspaceDir` + scanning the project directory for the most
   * recently modified `.jsonl`. The fallback covers operators who
   * haven't run our install.sh's hook-config step.
   */
  runMetadata: Map<string, { runStartTime: number; transcriptPath?: string }>;
}

// ---------------------------------------------------------------------------
// Logging — never throws, structured JSON to stderr. Mirrors evermemos
// pattern of swallowing log-write failures so logging itself can't
// crash the plugin host.
// ---------------------------------------------------------------------------

type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * Module-scope OpenClaw logger ref. Populated in `register(api)` so
 * runtime hooks can route log lines through OpenClaw's gateway logger
 * (which gets captured in /tmp/openclaw/openclaw-*.log). `console.log`
 * from runtime hooks is silenced by the gateway (goes to the agent
 * subprocess's stdout, not the gateway's). VPS E2E 2026-05-12: 8
 * sessions ran with our `structuredLog → stderr` calls invisible in
 * the gateway log; only the install-time validation pass surfaced
 * them. Reference: openclaw@2026.5.4 plugin-sdk/src/plugins/types.d.ts
 * (PluginLogger interface).
 */
type PluginLoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};
let pluginLogger: PluginLoggerLike | null = null;

export function setPluginLogger(logger: PluginLoggerLike | null): void {
  pluginLogger = logger;
}

function structuredLog(
  level: LogLevel,
  component: string,
  msg: string,
  data?: unknown,
): void {
  let entry: string;
  try {
    entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      plugin: PLUGIN_ID,
      component,
      msg,
      ...(data !== undefined ? { data } : {}),
    });
  } catch {
    return;
  }
  if (pluginLogger !== null) {
    const sink =
      level === "WARN"
        ? pluginLogger.warn
        : level === "ERROR"
          ? pluginLogger.error
          : pluginLogger.info;
    try {
      sink(entry);
      return;
    } catch {
      // Fall through to stderr if the logger throws.
    }
  }
  try {
    process.stderr.write(entry + "\n");
  } catch {
    // Logging failures must never crash the plugin host.
  }
}

// ---------------------------------------------------------------------------
// Entry signing — per-entry ECDSA via the plugin's wallet.
// ---------------------------------------------------------------------------
//
// Convention is the agent-wrapper signing format (ADR-07):
//   message = `${agentId}|${sealId}|${signedAt}|${outputHash}`
//   digest  = keccak256(message)   (raw, NO EIP-191 prefix)
//   sig     = wallet.signingKey.sign(digest).serialized
//
// Verification (dashboard): ecrecover(digest, sig) === entry.agentId.
// This is the SAME convention defi-swap-demo.ts uses, and the same
// MockTEEVerifier.verifyTEESignature recovers — except instead of
// checking the recovered address against a global teeOracleAddress,
// the dashboard checks it against the entry's own agentId. That
// removes the "MockTEEVerifier oracle === plugin wallet" coupling
// that previously made every real plugin-captured entry show as
// "Unsigned" (VPS E2E 2026-05-12 finding).

import { keccak256, toUtf8Bytes } from "ethers";

function deriveSealId(sessionKey: string, seq: number): string {
  // bytes32 hex, deterministic per (session, seq) so verification can
  // reproduce the seal without storing it separately.
  const digest = createHash("sha256")
    .update(`seal:${sessionKey}:${seq}`, "utf8")
    .digest("hex");
  return `0x${digest}`;
}

function signEntryDigest(
  signer: Wallet,
  agentId: string,
  sealId: string,
  signedAt: number,
  outputHash: string,
): string {
  // Match defi-swap-demo.ts exactly: keccak256 over the
  // pipe-delimited string, signed RAW (no EIP-191 prefix). The
  // wallet's signingKey.sign accepts a 32-byte digest directly.
  const message = `${agentId}|${sealId}|${signedAt}|${outputHash}`;
  const digest = keccak256(toUtf8Bytes(message));
  return signer.signingKey.sign(digest).serialized;
}

/**
 * Build a fully-signed ExecutionLogEntry from a raw payload, using the
 * plugin's wallet as the signing key. agentId is taken from state.config
 * (which is auto-bound to signer.address at register time), sealId is
 * derived deterministically from (sessionKey, seq), signedAt = now().
 *
 * Hashes use sha256 (per ADR-08's ExecutionLogEntry schema), the
 * signing digest uses keccak256 (per agent-wrapper's signing
 * convention). The two are intentionally different — sha256 hashes
 * are content-addressable identifiers; keccak signatures are EVM-
 * native and verify in Solidity ecrecover without extra preprocessing.
 */
function buildSignedEntry(
  state: PluginState,
  sessionKey: string,
  seq: number,
  raw: {
    type: "tool_call" | "session_start" | "session_end";
    tool?: string;
    modelId?: string;
    inputHash: string;
    outputHash: string;
    params?: unknown;
    result?: unknown;
  },
): {
  seq: number;
  ts: number;
  type: "tool_call" | "session_start" | "session_end";
  tool?: string;
  modelId?: string;
  inputHash: string;
  outputHash: string;
  agentId: string;
  sealId: string;
  signedAt: number;
  teeSignature: string;
  params?: unknown;
  result?: unknown;
} {
  const ts = Date.now();
  const signedAt = Math.floor(ts / 1000);
  const sealId = deriveSealId(sessionKey, seq);
  const teeSignature = signEntryDigest(
    state.signer,
    state.config.agentId,
    sealId,
    signedAt,
    raw.outputHash,
  );
  return {
    seq,
    ts,
    type: raw.type,
    ...(raw.tool !== undefined ? { tool: raw.tool } : {}),
    ...(raw.modelId !== undefined ? { modelId: raw.modelId } : {}),
    inputHash: raw.inputHash,
    outputHash: raw.outputHash,
    agentId: state.config.agentId,
    sealId,
    signedAt,
    teeSignature,
    ...(raw.params !== undefined ? { params: raw.params } : {}),
    ...(raw.result !== undefined ? { result: raw.result } : {}),
  };
}

// ---------------------------------------------------------------------------
// Container hash derivation — deterministic synthetic per the docstring
// note above. Re-derivable from public session metadata.
// ---------------------------------------------------------------------------

function deriveContainerHash(opts: {
  sessionKey: string;
  agentId: string;
}): string {
  const digest = createHash("sha256")
    .update(`openclaw-session:${opts.sessionKey}:${opts.agentId}`, "utf8")
    .digest("hex");
  return `0x${digest}`;
}

// ---------------------------------------------------------------------------
// State construction — happy path. Resolves the wallet via the
// auto-managed pattern (wallet.ts): env override > disk cache >
// freshly generated. Throws ONLY on 0G SDK construction failure.
// ---------------------------------------------------------------------------

function buildPluginState(config: VerifiableExecutionConfig): PluginState {
  // Auto-managed wallet — no PRIVATE_KEY env required for the demo
  // path. First run generates + persists to ~/.openclaw/verifiable-execution/wallet.json.
  // Subsequent runs read from disk. PRIVATE_KEY env still works as
  // an advanced override.
  // Honor config.privateKeyEnvVar so operators running multiple agents
  // on one host can keep their keys in different env vars.
  // (Codex P2 on PR #23: previously the env-var name was fixed at PRIVATE_KEY.)
  const wallet = resolveWallet({ envVarName: config.privateKeyEnvVar });
  printFirstRunBanner(wallet);
  structuredLog("INFO", "wallet", "Wallet resolved", {
    address: wallet.address,
    source: wallet.source,
  });

  // Auto-fill agentId from the wallet if the operator didn't supply
  // one. resolveConfig returns agentId="" for the missing case (zero
  // address is also treated as unset). The wallet IS the agent
  // identity by default — operators who want a different on-chain
  // attribution override agentId in openclaw.json.
  if (config.agentId === "") {
    config = { ...config, agentId: wallet.address };
    structuredLog("INFO", "config", "agentId auto-bound to wallet address", {
      agentId: wallet.address,
    });
  }

  // Storage signer needs a provider attached — ethers v6.13 throws
  // `missing provider (UNSUPPORTED_OPERATION)` on ANY chain call
  // (including `eth_getTransactionCount` that StorageClient does to
  // build its upload tx). Discovered on VPS E2E v0.1.3: anchor.anchor()
  // reached AGEND_ANCHORING, then threw `StorageUploadError: Upload
  // threw instead of returning [result, err]: missing provider`.
  // Pre-v0.1.4 used `new Wallet(privateKey)` (no provider) which only
  // worked in tests because the test fixtures don't actually upload.
  const storageProvider = new JsonRpcProvider(config.rpcUrl);
  const storageSigner = new Wallet(wallet.privateKey, storageProvider);

  const indexer = new Indexer(config.indexerUrl);
  const storageClient = new StorageClient({
    rpcUrl: config.rpcUrl,
    indexerUrl: config.indexerUrl,
    signer: storageSigner,
    indexer: indexer as unknown as IndexerLike,
  });

  const agenticIdClient = AgenticIDClient.fromRpc(
    config.agenticIdAddress,
    config.rpcUrl,
    wallet.privateKey,
  );

  const sessions = new SessionManager({ storageClient });
  // v0.3.0: keystore is a sibling to wallet.json under
  // ~/.openclaw/verifiable-execution/. Default constructor uses that
  // path; tests inject a temp dir.
  const keystore = new Keystore();
  // The storageSigner (already provider-connected) doubles as our
  // entry-signing key. agentId is the wallet's address, so signatures
  // recover to the agentId field on each entry — that's how the
  // dashboard's "Signed by 0x…" badge becomes green without needing
  // MockTEEVerifier's global teeOracleAddress to match.
  return {
    config,
    sessions,
    agenticIdClient,
    signer: storageSigner,
    keystore,
    pendingAnchors: new Map<string, SessionLogger>(),
    runMetadata: new Map<
      string,
      { runStartTime: number; transcriptPath?: string }
    >(),
  };
}

// ---------------------------------------------------------------------------
// Hook handlers — exported so tests can drive them with synthetic
// (event, ctx) tuples without standing up an OpenClaw runtime.
// ---------------------------------------------------------------------------

/**
 * after_tool_call handler — append an ExecutionLogEntry to the session's
 * SessionLogger. Lazy-allocates the SessionLogger on first sight of a
 * sessionKey (OpenClaw does not expose `session_start` so we cannot
 * pre-allocate). Never throws — tool errors are themselves captured as
 * log entries with the error payload reflected in `outputHash`. The
 * BDD's "tool_error" type is mapped to type:"tool_call" + the error
 * captured in the hash, because the logger schema doesn't include a
 * separate tool_error variant (would be a cross-package change in a
 * different epic).
 */
export function handleAfterToolCall(
  state: PluginState,
  event: { toolName?: unknown; params?: unknown; result?: unknown; error?: unknown },
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): void {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "after_tool_call", "Skipping entry: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }
  const toolName = typeof event.toolName === "string" ? event.toolName : "<unknown>";

  let logger: SessionLogger;
  try {
    logger = state.sessions.getOrCreate(sessionKey);
  } catch (cause) {
    structuredLog("ERROR", "after_tool_call", "Failed to allocate SessionLogger", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }

  // Compose the entry. Tool errors land in outputHash via the
  // {error} envelope so downstream verifiers see SOMETHING captured
  // for the failure (vs the entry being absent and the proof chain
  // having an inferred gap).
  //
  // sha256Hex never throws (it catches JSON.stringify failures and
  // falls back to a `<<unserializable:T>>` sentinel internally), but
  // we wrap the entire compose+append block in try/catch as a
  // defense-in-depth so any unexpected throw on the path still gets
  // structured-logged instead of crashing the OpenClaw host. (Codex
  // Epic 4 round-1 P1: invalid input must not prevent the log entry
  // from being created.)
  try {
    const inputHash = sha256Hex(event.params);
    const outputPayload =
      event.error !== undefined
        ? { error: serializeError(event.error) }
        : event.result;
    const outputHash = sha256Hex(outputPayload);

    // Capture decoded content alongside the hashes (Stage 3 of the
    // zero-config UX work, 2026-05-06). Hashes alone are PROOF OF
    // EXISTENCE; decoded content is what makes the dashboard
    // "Etherscan for AI agents" instead of a JSON viewer. We
    // serialize-and-reparse so unserializable values (BigInt,
    // circular refs) are filtered to undefined → entry stores only
    // what's safely JSON-roundtrippable. The hash fields anchor
    // integrity even when the decoded content is omitted.
    const decodedParams = safeJsonRoundtrip(event.params);
    const decodedResult = safeJsonRoundtrip(outputPayload);

    // seq from getStatus().entryCount (O(1)) — the prior version used
    // logger.getEntries().length which clones the entry array on every
    // call (O(n) per append → O(n²) for an N-tool-call session). For
    // long-running sessions on agents that hammer tools every few
    // seconds this would dominate session-end memory + CPU. (Closes
    // Codex web R3 P2 on PR #20.)
    const entry = buildSignedEntry(state, sessionKey, logger.getStatus().entryCount, {
      type: "tool_call",
      tool: toolName,
      inputHash,
      outputHash,
      // Decoded content (Stage 3 — Etherscan-grade story not just hashes).
      // Omitted from the entry when undefined (schema fields are optional)
      // so unserializable inputs don't bloat the log with empty fields.
      ...(decodedParams !== undefined ? { params: decodedParams } : {}),
      ...(decodedResult !== undefined ? { result: decodedResult } : {}),
    });
    logger.appendEntry(entry);
  } catch (cause) {
    // appendEntry can throw on schema-mismatch or post-flush; sha256Hex
    // is now hardened so the only realistic causes are the former.
    // Log + swallow — never crash the host.
    structuredLog("ERROR", "after_tool_call", "Failed to append log entry", {
      sessionKey,
      tool: toolName,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * message_received handler — appends the USER's raw inbound message as a
 * `user_input` entry. Fires once per incoming Telegram/Discord/CLI
 * message before the agent has done any work. Without this, the timeline
 * is missing the most important context ("what did the user actually
 * ASK the agent?") and looks like the agent talked to itself.
 *
 * Per PluginHookMessageReceivedEvent (openclaw@2026.5.4
 * plugin-sdk/src/plugins/hook-types.d.ts:155-167): `event.content` is
 * the raw inbound string; `ctx.channelId` + `ctx.senderId` give routing
 * context. We store only the content + minimal metadata — channel/
 * senderId are routing identifiers, not part of the on-chain attestation.
 */
export function handleMessageReceived(
  state: PluginState,
  event: { content?: unknown; senderId?: unknown },
  ctx: { sessionKey?: unknown; sessionId?: unknown; channelId?: unknown },
): void {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "message_received", "Skipping: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }
  // v0.3.5: pin the run-start timestamp BEFORE any logger work. We
  // use this at agent_end time to filter the claude-cli session
  // jsonl to "events emitted during THIS run." Without this, we'd
  // re-anchor every tool call ever recorded in the jsonl, every turn.
  // Set BEFORE getOrCreate so a thrown logger allocation still leaves
  // the metadata in place — handleAgentEnd's read path tolerates
  // missing logger but needs the runStartTime.
  state.runMetadata.set(sessionKey, { runStartTime: Date.now() });
  let logger: SessionLogger;
  try {
    logger = state.sessions.getOrCreate(sessionKey);
  } catch (cause) {
    structuredLog("ERROR", "message_received", "Failed to allocate SessionLogger", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }
  try {
    const inputPayload = { senderId: event.senderId, channelId: ctx.channelId };
    const outputPayload = { content: event.content };
    const inputHash = sha256Hex(inputPayload);
    const outputHash = sha256Hex(outputPayload);
    const entry = buildSignedEntry(state, sessionKey, logger.getStatus().entryCount, {
      type: "tool_call",
      tool: "user_input",
      inputHash,
      outputHash,
      params: safeJsonRoundtrip(inputPayload),
      result: safeJsonRoundtrip(outputPayload),
    });
    logger.appendEntry(entry);
  } catch (cause) {
    structuredLog("ERROR", "message_received", "Failed to append user_input entry", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * before_prompt_build handler — appends a `prompt_build` entry recording
 * the FULL prompt + system prompt + history the agent is about to
 * send to the LLM. v0.2.0 stripped these for privacy; v0.3.0
 * encrypts the entire session log so storing them is safe — the
 * operator's `/share` is the only path that surfaces the key.
 *
 * Capturing the actual content is what makes the receipt useful
 * for audit: "agent received X system instructions, X-message
 * history, and asked the LLM Y" beats "390-char prompt length."
 * (Abu's feedback on token 65 receipt, 2026-05-13: "it doesn't
 * really make sense to me ... I'm only seeing prompt build and
 * hard speed and other name text. Like who the hell wants to do
 * this? Like, what, why do I even care about it?")
 *
 * Per PluginHookBeforePromptBuildEvent
 * (plugin-sdk/src/plugins/hook-types.d.ts:9, 226): fields include
 * `prompt`, `systemPrompt`, `historyMessages`, model identity.
 */
export function handleBeforePromptBuild(
  state: PluginState,
  event: {
    prompt?: unknown;
    systemPrompt?: unknown;
    historyMessages?: unknown;
  },
  ctx: {
    sessionKey?: unknown;
    sessionId?: unknown;
    modelProviderId?: unknown;
    modelId?: unknown;
  },
): void {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "before_prompt_build", "Skipping: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }
  let logger: SessionLogger;
  try {
    logger = state.sessions.getOrCreate(sessionKey);
  } catch (cause) {
    structuredLog("ERROR", "before_prompt_build", "Failed to allocate SessionLogger", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }
  try {
    const historyLen = Array.isArray(event.historyMessages)
      ? event.historyMessages.length
      : 0;
    // FULL CONTENT capture (encrypted at flush). The displayed
    // receipt now answers "what did the agent send to the LLM?"
    // not just "the prompt was 390 chars."
    const payload = {
      provider: ctx.modelProviderId,
      model: ctx.modelId,
      historyMessagesLength: historyLen,
      systemPromptLength:
        typeof event.systemPrompt === "string" ? event.systemPrompt.length : 0,
      promptLength: typeof event.prompt === "string" ? event.prompt.length : 0,
      // Actual content (encrypted in the on-storage envelope per v0.3.0):
      systemPrompt: typeof event.systemPrompt === "string" ? event.systemPrompt : undefined,
      prompt: typeof event.prompt === "string" ? event.prompt : undefined,
      historyMessages: Array.isArray(event.historyMessages)
        ? event.historyMessages
        : undefined,
    };
    const inputHash = sha256Hex({ sessionKey });
    const outputHash = sha256Hex(payload);
    const entry = buildSignedEntry(state, sessionKey, logger.getStatus().entryCount, {
      type: "tool_call",
      tool: "prompt_build",
      inputHash,
      outputHash,
      result: safeJsonRoundtrip(payload),
    });
    logger.appendEntry(entry);
  } catch (cause) {
    structuredLog("ERROR", "before_prompt_build", "Failed to append prompt_build entry", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * llm_output handler — captures every LLM response as an ExecutionLogEntry,
 * so even when an agent uses INTERNAL tools (Claude's bash/edit/grep that
 * live inside Claude's reasoning loop and never surface to OpenClaw's tool
 * dispatcher) we still anchor what the agent did. Without this, the only
 * agents we could attest to would be ones that use OpenClaw-dispatched
 * tools (Brave search, web fetch, memory lookup) — which excludes most
 * realistic agent workloads.
 *
 * The entry's `tool` field is set to "llm_call" to distinguish from
 * actual tool_call entries. The decoded `result.content` is the model's
 * full response (which contains any inline tool calls in JSON form for
 * verifiable replay). The OpenClaw payload shape is intentionally
 * loose-typed (`{ content?: unknown }`) because the SDK's
 * PluginHookLlmOutputEvent declares many optional fields that differ
 * across provider backends.
 *
 * Why mirror handleAfterToolCall structure: the entry schema is the same
 * (ExecutionLogEntry), the failure modes are the same (sessionKey
 * missing → log + return; appendEntry throws → log + return), and the
 * dashboard renders both via the same EntryCard component. Code reuse
 * via a private helper would make the BDD-to-test mapping less direct.
 */
export function handleLlmOutput(
  state: PluginState,
  event: {
    runId?: unknown;
    sessionId?: unknown;
    provider?: unknown;
    model?: unknown;
    resolvedRef?: unknown;
    harnessId?: unknown;
    assistantTexts?: unknown;
    lastAssistant?: unknown;
    usage?: unknown;
  },
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): void {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "llm_output", "Skipping entry: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }

  let logger: SessionLogger;
  try {
    logger = state.sessions.getOrCreate(sessionKey);
  } catch (cause) {
    structuredLog("ERROR", "llm_output", "Failed to allocate SessionLogger", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return;
  }

  try {
    const inputDescriptor = {
      runId: event.runId,
      provider: event.provider,
      model: event.model,
      resolvedRef: event.resolvedRef,
      harnessId: event.harnessId,
    };
    const inputHash = sha256Hex(inputDescriptor);
    const decodedInput = safeJsonRoundtrip(inputDescriptor);

    // v0.2.0: parse `lastAssistant.content` into discrete entries when
    // possible — one per block (thinking / tool_use / text). Falls back
    // to a single `llm_call` entry for the legacy assistantTexts-only
    // shape. Reference: @mariozechner/pi-ai types.d.ts:98-146 (the
    // AssistantMessage content union) + OpenClaw provider-stream-shared
    // normalizer that aliases `toolCall` ↔ `tool_use` across providers.
    const blocks = parseAssistantBlocks(event.lastAssistant);
    if (blocks.length === 0) {
      // Fallback path — no parseable blocks, emit one bundle entry
      // with the whole response. Preserves pre-v0.2.0 behavior for
      // providers that don't expose structured content.
      const outputPayload = {
        assistantTexts: event.assistantTexts,
        lastAssistant: event.lastAssistant,
        usage: event.usage,
      };
      const outputHash = sha256Hex(outputPayload);
      const decodedOutput = safeJsonRoundtrip(outputPayload);
      const entry = buildSignedEntry(
        state,
        sessionKey,
        logger.getStatus().entryCount,
        {
          type: "tool_call",
          tool: "llm_call",
          inputHash,
          outputHash,
          ...(decodedInput !== undefined ? { params: decodedInput } : {}),
          ...(decodedOutput !== undefined ? { result: decodedOutput } : {}),
        },
      );
      logger.appendEntry(entry);
      return;
    }

    // Multi-entry path — one ExecutionLogEntry per block.
    for (const block of blocks) {
      const seq = logger.getStatus().entryCount;
      // outputHash is per-block so each entry's signature is over its
      // own content; inputHash stays the shared model-call descriptor
      // so a verifier can re-bundle blocks belonging to one llm_output.
      const blockOutputHash = sha256Hex(block);
      const decodedBlock = safeJsonRoundtrip(block);
      const entry = buildSignedEntry(state, sessionKey, seq, {
        type: "tool_call",
        tool: block.kind, // "reasoning" | "tool_use" | "llm_text"
        inputHash,
        outputHash: blockOutputHash,
        ...(decodedInput !== undefined ? { params: decodedInput } : {}),
        ...(decodedBlock !== undefined ? { result: decodedBlock } : {}),
      });
      logger.appendEntry(entry);
    }
  } catch (cause) {
    structuredLog("ERROR", "llm_output", "Failed to append llm_output entry", {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Parse a Claude/Anthropic-style AssistantMessage.content array into
 * discrete blocks. Returns [] when content isn't an array OR no
 * recognized blocks are found — caller falls back to single-entry
 * emit in that case.
 *
 * Recognized block types (from @mariozechner/pi-ai types.d.ts:98-146):
 *   - { type: "text", text }                            → llm_text
 *   - { type: "thinking", thinking }                    → reasoning
 *   - { type: "toolCall" | "tool_use", name, input/arguments }  → tool_use
 *
 * OpenClaw's provider-stream-shared normalizer aliases `toolCall` ↔
 * `tool_use` across providers (Anthropic uses tool_use; OpenAI uses
 * toolCall) — we accept both verbatim.
 */
export function parseAssistantBlocks(
  lastAssistant: unknown,
): Array<
  | { kind: "llm_text"; text: string }
  | { kind: "reasoning"; thinking: string }
  | { kind: "tool_use"; name: string; arguments: unknown; toolCallId?: string }
> {
  if (lastAssistant === null || typeof lastAssistant !== "object") return [];
  const content = (lastAssistant as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  const out: ReturnType<typeof parseAssistantBlocks> = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const type = typeof b.type === "string" ? b.type : "";
    if (type === "text" && typeof b.text === "string") {
      out.push({ kind: "llm_text", text: b.text });
    } else if (type === "thinking" && typeof b.thinking === "string") {
      out.push({ kind: "reasoning", thinking: b.thinking });
    } else if (type === "toolCall" || type === "tool_use") {
      const name =
        typeof b.name === "string"
          ? b.name
          : typeof b.toolName === "string"
            ? (b.toolName as string)
            : "<unknown>";
      // Anthropic uses `input`; OpenClaw normalized form uses `arguments`.
      const args = b.arguments !== undefined ? b.arguments : b.input;
      const toolCallId =
        typeof b.toolCallId === "string"
          ? b.toolCallId
          : typeof b.id === "string"
            ? (b.id as string)
            : undefined;
      out.push({
        kind: "tool_use",
        name,
        arguments: args,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
      });
    }
  }
  return out;
}

/**
 * Private helper shared by `handleAgentEnd` and `handleSessionEnd`.
 *
 * Sequencing — the approved plan's invariant (`setPending →
 * takeAndRelease → pendingAnchors.set → flush`) is owned by the
 * CALLER:
 *
 *   (caller) gate on state.sessions.has(sessionKey)
 *   (caller) generate K + build pendingKeyName
 *   (caller) keystore.setPending (synchronous; if throws, logger
 *            STAYS in state.sessions → next agent_end auto-retries
 *            on the same sessionKey, no manual recovery needed)
 *   (caller) takeAndRelease (synchronous; new message_received on
 *            this sessionKey gets a fresh logger)
 *   (caller) state.pendingAnchors.set (synchronous; holds the
 *            UN-flushed logger only)
 *
 *   (here)   anchor.anchor({encrypt, dataDescriptionPrefix}) — async
 *   (here)   state.pendingAnchors.delete — bytes durable, free memory
 *   (here)   keystore.commitPending — separate try/catch (round-6)
 *
 * `dataDescriptionPrefix` is "exec-log" for normal agent_end anchors,
 * "exec-log-orphan" for session_end recovery anchors. `component`
 * drives the structured-log component tag.
 *
 * `encryptionKey` is OWNED by the caller because the keystore
 * setPending write happens in the caller (we have to know if it
 * succeeded before we touch the SessionLogger map); we just need it
 * here to wire the AES-GCM cipher closure.
 *
 * Pre-flush failures: the plaintext logger is the ONLY copy of those
 * entries — pendingAnchors keeps it for manual recovery.
 * Post-flush failures (mint or commit): bytes are durable on 0G
 * Storage, so pendingAnchors clears immediately.
 */
async function anchorRun(
  state: PluginState,
  logger: SessionLogger,
  sessionKey: string,
  runId: string,
  pendingKeyName: string,
  encryptionKey: Buffer,
  dataDescriptionPrefix: string,
  component: "agent_end" | "session_end",
): Promise<void> {
  const containerHash = deriveContainerHash({
    sessionKey,
    agentId: state.config.agentId,
  });

  const anchor = new SessionAnchor(
    logger,
    state.agenticIdClient,
    state.config.agentId,
    state.config.modelId,
    { chainId: state.config.chainId },
  );

  // Hoist `result` with `let` (round-7) so the post-mint commit
  // block can reference txHash/rootHash/entryCount in its error
  // payload after the flush/mint try-block closes.
  let result: {
    tokenId: bigint;
    txHash: string;
    rootHash: string;
    entryCount: number;
    verifyUrl: string;
  };
  try {
    result = await anchor.anchor({
      sessionId: sessionKey,
      containerHash,
      dataDescriptionPrefix,
      // Encrypt the plaintext SessionLog JSON into our v1 envelope, then
      // upload the JSON-encoded envelope bytes. dashboard's
      // isEncryptedEnvelope() distinguishes these from legacy plaintext
      // SessionLogs (token 0 + all pre-v0.3.0 receipts).
      encrypt: (plaintextJson: string): Uint8Array => {
        const envelope = encryptSessionLog(plaintextJson, encryptionKey);
        return new TextEncoder().encode(JSON.stringify(envelope));
      },
    });
    // Mint succeeded → encrypted bytes are durable on 0G Storage.
    // The plaintext logger is no longer needed for recovery
    // (rootHash + entryCount + sessionId + dataDescriptionPrefix are
    // enough — they're surfaced on SessionAnchorMintAfterFlushError
    // too). Free the memory NOW; round-4 narrowing.
    state.pendingAnchors.delete(pendingKeyName);
  } catch (cause) {
    if (cause instanceof SessionAnchorMintAfterFlushError) {
      // Flush succeeded → bytes durable on 0G Storage → plaintext
      // logger no longer load-bearing for recovery. Free it.
      state.pendingAnchors.delete(pendingKeyName);
      structuredLog(
        "ERROR",
        component,
        "Mint failed after successful flush — bytes on 0G Storage but no on-chain anchor",
        {
          runId,
          rootHash: cause.rootHash,
          entryCount: cause.entryCount,
          sessionId: cause.sessionId,
          dataDescriptionPrefix: cause.dataDescriptionPrefix,
          pendingKeyName,
          sessionKey,
          recovery:
            `Call sessionAnchor.retryMint({rootHash:"${cause.rootHash}", ` +
            `entryCount:${cause.entryCount}, sessionId:"${cause.sessionId}", ` +
            `dataDescriptionPrefix:"${cause.dataDescriptionPrefix}"}) → captures <newTokenId>. ` +
            `Then keystore.commitPending("${pendingKeyName}", <newTokenId>, ` +
            `{sessionKey:"${sessionKey}", runId:"${runId}"}).`,
        },
      );
    } else {
      // Pre-flush failure: flush itself threw before producing a
      // rootHash. The plaintext logger in pendingAnchors is the ONLY
      // copy of those entries — leave it registered so an operator
      // can manually flush+mint+commit. (Round-4 finding #1: this
      // is the ONLY failure path that keeps the registry entry.)
      structuredLog(
        "ERROR",
        component,
        "Flush failed before mint — plaintext logger retained in pendingAnchors for manual recovery",
        {
          runId,
          pendingKeyName,
          sessionKey,
          cause: cause instanceof Error ? cause.message : String(cause),
          recovery:
            `Logger retained in state.pendingAnchors["${pendingKeyName}"]. ` +
            `Recovery steps: ` +
            `(1) const logger = state.pendingAnchors.get("${pendingKeyName}"); ` +
            `(2) await logger.flush({encrypt}) → captures <rootHash>; ` +
            `(3) await agenticIdClient.mint(agentId, [{dataDescription:"${dataDescriptionPrefix}:${sessionKey}:${state.config.modelId}", dataHash:<rootHash>}]) → captures <newTokenId>; ` +
            `(4) state.keystore.commitPending("${pendingKeyName}", <newTokenId>, {sessionKey:"${sessionKey}", runId:"${runId}"}); ` +
            `(5) state.pendingAnchors.delete("${pendingKeyName}").`,
        },
      );
    }
    return;
  }

  // Mint succeeded; registry is already cleared. The commit block
  // runs in its OWN try/catch (round-6) so an FS-only failure on
  // commit doesn't get misclassified as "flush failed."
  const tokenId = result.tokenId.toString();
  try {
    const committed = state.keystore.commitPending(pendingKeyName, tokenId, {
      sessionKey,
      runId,
    });
    if (!committed) {
      // Pending file vanished between setPending and commitPending
      // (unusual — operator wiped it manually, or two anchorRun calls
      // raced through the same pendingKeyName which shouldn't happen
      // post-base64url-encoding).
      //
      // Codex round-2 v0.3.4-12: pass the same {sessionKey, runId}
      // meta bag through to `put()` so `last-receipt.json` keeps the
      // BARE sessionKey + runId. The pre-v0.3.4 path silently used
      // `put(tokenId, K)` which wrote `sessionKey: direct-put:<tokenId>`
      // and dropped runId — a regression on the v0.3.4 metadata contract.
      state.keystore.put(tokenId, encryptionKey, { sessionKey, runId });
      structuredLog(
        "WARN",
        component,
        "commitPending returned false — pending sidecar missing; recovered via direct put with meta",
        { runId, tokenId, pendingKeyName, sessionKey },
      );
    }
  } catch (commitErr) {
    structuredLog(
      "ERROR",
      component,
      "Keystore commit failed AFTER successful mint — receipt is on-chain but local key isn't yet bound to tokenId",
      {
        runId,
        tokenId,
        txHash: result.txHash,
        rootHash: result.rootHash,
        pendingKeyName,
        sessionKey,
        cause: commitErr instanceof Error ? commitErr.message : String(commitErr),
        recovery:
          `Receipt minted as tokenId ${tokenId} (tx ${result.txHash}). ` +
          `To bind the local key for /share, fix the FS issue then run: ` +
          `keystore.commitPending("${pendingKeyName}", "${tokenId}", ` +
          `{sessionKey:"${sessionKey}", runId:"${runId}"}). ` +
          `If the pending key file is gone, the receipt's contents are ` +
          `unrecoverable from THIS host (the rootHash is on 0G Storage ` +
          `but the AES key was lost).`,
      },
    );
    return;
  }

  // SECURITY (Codex round-9 P1): the reveal key MUST NOT appear in
  // log streams. The operator obtains the share URL ON DEMAND via
  // the `/share` command (handleShareCommand reads the key from the
  // keystore at request time).
  //
  // PRIVACY (Codex round-16): sessionKey MUST NOT appear in the
  // routine success log. OpenClaw sessionKeys often encode channel
  // routing context (e.g. Telegram user IDs); auto-logging them
  // would leak who-uses-the-bot metadata to gateway log collectors.
  // sessionKey is retained only in error/recovery log lines where
  // the operator needs it to drive retryMint / commitPending.
  const baseUrl = `${state.config.verifyUrlBase.replace(/\/$/, "")}${result.verifyUrl}`;
  structuredLog("INFO", component, "Session anchored on-chain", {
    runId,
    tokenId,
    txHash: result.txHash,
    rootHash: result.rootHash,
    entryCount: result.entryCount,
    verifyUrl: baseUrl,
    // shareUrl + sessionKey intentionally omitted (round-9 + round-16).
  });
}

/**
 * v0.3.5 helper — reads the claude-cli session jsonl tied to the
 * given sessionKey, extracts tool_use/tool_result pairs, and appends
 * one signed `tool_call` entry per pair to the SessionLogger.
 *
 * Path resolution priority (so this works with OR without Claude
 * Code's native hooks configured):
 *   1. `state.runMetadata.get(sessionKey).transcriptPath` — pinned
 *      by `before_agent_finalize` (preferred; exact path).
 *   2. `ctx.workspaceDir` → most-recently-modified jsonl under
 *      `~/.claude/projects/<encoded-workspaceDir>/` (fallback for
 *      operators who haven't wired native hooks into Claude Code's
 *      `.claude/settings.json`).
 *
 * Returns without appending if neither resolution succeeds OR if the
 * transcript has no matching tool calls in this run's window. The
 * call site treats this whole step as additive — any failure leaves
 * the existing entries (prompt_build, llm_text, etc.) intact.
 *
 * Dedup: existing logger entries' `params.toolCallId` is compared
 * against each transcript tool_use `id`. Tools already captured by
 * `handleAfterToolCall` (OpenClaw-routed MCP/gateway tools) don't
 * get double-counted.
 */
function injectTranscriptToolEntries(opts: {
  state: PluginState;
  logger: SessionLogger;
  sessionKey: string;
  workspaceDir: string | undefined;
}): void {
  const { state, logger, sessionKey, workspaceDir } = opts;
  const meta = state.runMetadata.get(sessionKey);

  // Resolve transcript path: pinned path first, fallback to filesystem
  // probe if Claude Code's native hooks didn't wire before_agent_finalize.
  let transcriptPath = meta?.transcriptPath;
  if (transcriptPath === undefined && workspaceDir !== undefined) {
    transcriptPath = resolveClaudeCliTranscriptPath(workspaceDir) ?? undefined;
  }
  if (transcriptPath === undefined) {
    // No path resolved — common for non-claude-cli providers (anthropic
    // direct, codex, etc.). Their tool calls flow through
    // OpenClaw's tool dispatcher → after_tool_call already captured
    // them. Silent no-op.
    return;
  }

  const runStartTime = meta?.runStartTime ?? Date.now() - 5 * 60 * 1000;
  // 5-minute lookback for the no-message_received corner case (rare:
  // agent_end fires without a preceding message_received that set
  // runStartTime). Better to over-capture one turn's worth of events
  // than to silently miss every tool call.

  let toolCalls: TranscriptToolCall[];
  try {
    toolCalls = parseTranscriptToolCalls(transcriptPath, runStartTime);
  } catch (cause) {
    structuredLog(
      "WARN",
      "agent_end",
      "Failed to parse claude-cli transcript; tool entries will be missing from receipt",
      {
        sessionKey,
        transcriptPath,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
    return;
  }
  if (toolCalls.length === 0) return;

  // Dedup against tool calls already captured by handleAfterToolCall.
  // Each existing tool_call entry MAY carry `params.toolCallId` if it
  // came from after_tool_call (which forwards the Anthropic id). The
  // synthetic entries from message_received / prompt_build / llm_text
  // don't carry one, so they won't match (safe).
  const existingToolCallIds = new Set<string>();
  for (const entry of logger.getEntries()) {
    const params = entry.params;
    if (params !== null && typeof params === "object") {
      const id = (params as { toolCallId?: unknown }).toolCallId;
      if (typeof id === "string" && id.length > 0) existingToolCallIds.add(id);
    }
  }

  let injected = 0;
  for (const tc of toolCalls) {
    if (existingToolCallIds.has(tc.toolCallId)) continue;
    try {
      const inputHash = sha256Hex({ toolCallId: tc.toolCallId, input: tc.input });
      // Store the full result content. tool_result blocks from
      // Claude Code's Read/WebSearch/etc. are bounded (search hits
      // truncate; Read caps at ~30k tokens) so this won't blow up
      // the SessionLog. Plus the whole log is encrypted at flush
      // time per v0.3.0 — content stays private behind /share.
      const outputPayload = tc.isError
        ? { error: tc.result }
        : { result: tc.result };
      const outputHash = sha256Hex(outputPayload);
      const seq = logger.getStatus().entryCount;
      const entry = buildSignedEntry(state, sessionKey, seq, {
        type: "tool_call",
        tool: tc.toolName,
        inputHash,
        outputHash,
        params: { toolCallId: tc.toolCallId, input: tc.input },
        result: outputPayload,
      });
      logger.appendEntry(entry);
      injected++;
    } catch (cause) {
      structuredLog(
        "WARN",
        "agent_end",
        "Skipped injecting one transcript tool entry due to append failure",
        {
          sessionKey,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }
  }
  if (injected > 0) {
    structuredLog(
      "INFO",
      "agent_end",
      "Injected transcript tool entries into receipt",
      {
        sessionKey,
        injected,
        transcriptPath,
      },
    );
  }
}

/**
 * before_agent_finalize handler — v0.3.5 content-fidelity capture.
 *
 * Fires from OpenClaw's `native-hook-relay` bridge when Claude Code's
 * native hooks are wired into `.claude/settings.json` (our install.sh
 * seeds them; manual setups need to opt in). The event carries the
 * `transcriptPath` field — the on-disk path to Claude Code's session
 * jsonl, which contains every `tool_use`/`tool_result` block the
 * agent invoked during the run (Read, WebSearch, Bash, Edit, MCP
 * tools — every internal tool claude-cli runs, NONE of which fire
 * `after_tool_call` because they don't route through OpenClaw's
 * dispatcher).
 *
 * We stash the path against the sessionKey so handleAgentEnd can
 * read it at anchor time. The fallback for unconfigured Claude Code
 * setups (no native hooks) is to resolve the jsonl path from
 * `ctx.workspaceDir` + a most-recent-file scan, handled inside
 * handleAgentEnd.
 *
 * Return value: { action: "continue" } — we don't gate finalization,
 * just observe. Returning void also works (normalizeBeforeAgentFinalizeResult
 * treats undefined as "continue").
 */
export function handleBeforeAgentFinalize(
  state: PluginState,
  event: { transcriptPath?: unknown; runId?: unknown },
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): void {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    // No sessionKey context — can't pin the transcriptPath to a
    // session. Silently no-op (this hook fires routinely; not worth
    // a WARN log surface for every misrouted event).
    return;
  }
  const transcriptPath =
    typeof event.transcriptPath === "string" && event.transcriptPath.length > 0
      ? event.transcriptPath
      : undefined;
  if (transcriptPath === undefined) {
    // No transcriptPath in event — either Claude Code didn't pass one
    // (older versions, or the stop-hook variant) or the relay didn't
    // forward it. Leave existing runMetadata in place; handleAgentEnd
    // will fall back to filesystem-probe resolution.
    return;
  }
  const existing = state.runMetadata.get(sessionKey);
  // Preserve the earlier runStartTime from handleMessageReceived if
  // present. Without it (rare: before_agent_finalize fired without a
  // preceding message_received), set runStartTime now so the jsonl
  // filter has SOMETHING to compare against — better to over-capture
  // a turn's worth of events than to drop them all.
  state.runMetadata.set(sessionKey, {
    runStartTime: existing?.runStartTime ?? Date.now(),
    transcriptPath,
  });
}

/**
 * agent_end handler — anchors ONE token per agent run. v0.3.4: this
 * is the PRIMARY anchor path. `agent_end` fires when the agent
 * completes its reply to a single user message; "one agent_end = one
 * token" is the audit unit the user sees in the dashboard feed.
 *
 * The atomic rotate (`takeAndRelease`) is critical: holds the
 * SessionLogger out of `state.sessions` for the entire flush + mint
 * window so a NEW `message_received` on the same sessionKey gets a
 * FRESH SessionLogger and the next turn's entries don't land in the
 * one we're flushing. Without it, two-message-in-a-row Telegram users
 * would silently lose half their entries.
 */
export async function handleAgentEnd(
  state: PluginState,
  event: unknown,
  ctx: {
    sessionKey?: unknown;
    sessionId?: unknown;
    workspaceDir?: unknown;
  },
): Promise<void> {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "agent_end", "Skipping anchor: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }

  // Gate before keystore write — no point persisting an AES key for
  // a session that has zero entries (heartbeat agents, the second of
  // two hooks racing for the same sessionKey).
  if (!state.sessions.has(sessionKey)) {
    structuredLog("INFO", "agent_end", "No active SessionLogger; skipping anchor", {
      sessionKey,
    });
    return;
  }
  const existingLogger = state.sessions.getOrCreate(sessionKey);

  // v0.3.5 — inject transcript tool entries BEFORE the entryCount
  // gate. claude-cli's INTERNAL tools (Read/WebSearch/Bash/Edit/MCP)
  // never fire `after_tool_call`, so without this step the receipt
  // misses everything the agent actually did between prompt_build and
  // the final llm_text. The transcript jsonl is the only place these
  // tool calls are recorded. Failures here MUST NOT abort the
  // anchor — the in-memory entries still anchor cleanly; the tool
  // injection is additive.
  try {
    injectTranscriptToolEntries({
      state,
      logger: existingLogger,
      sessionKey,
      workspaceDir:
        typeof ctx.workspaceDir === "string" ? ctx.workspaceDir : undefined,
    });
  } catch (cause) {
    structuredLog(
      "WARN",
      "agent_end",
      "Transcript tool-entry injection failed; receipt will be missing claude-cli internal tools",
      {
        sessionKey,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }

  // Codex r9: a SessionLogger can exist with entryCount=0 if a prior
  // entry handler's getOrCreate succeeded but its append/sign block
  // threw (and was swallowed by structuredLog). Anchoring an empty
  // log would mint a content-less receipt — feed inflation. The plan
  // (Section "Architectural change" step 1) says "bail if no entries";
  // enforce it here.
  if (existingLogger.getStatus().entryCount === 0) {
    structuredLog("INFO", "agent_end", "SessionLogger has zero entries; skipping empty anchor", {
      sessionKey,
    });
    state.sessions.release(sessionKey);
    state.runMetadata.delete(sessionKey);
    return;
  }

  // Use `event.runId` from the OpenClaw hook payload when available.
  // Some harnesses (CLI, voice-call) don't populate it; fall back to
  // a 16-byte hex synthetic so the compound pendingKeyName stays
  // unique-per-run even without runtime support. randomBytes(16)
  // gives 128 bits of entropy — well above the birthday-collision
  // threshold for typical operator session counts.
  //
  // `event` is typed as `unknown` so callers (tests + the runtime
  // OpenClaw lambda) can pass the full PluginHookAgentEndEvent shape
  // ({runId, messages, success, error, durationMs}) without per-field
  // TS excess-property errors. We narrow `runId` defensively here.
  const eventRunId =
    event !== null && typeof event === "object" && "runId" in event
      ? (event as { runId?: unknown }).runId
      : undefined;
  const runId =
    typeof eventRunId === "string" && eventRunId.length > 0
      ? eventRunId
      : `anon-${randomBytes(16).toString("hex")}`;
  // COMPOUND pending-key identity so two concurrent agent_ends on
  // the same sessionKey (rare but legitimate: harness queues two
  // runs) get distinct filesystem entries. Round-2 finding #4
  // caught the collision in the prior `setPending(sessionKey, K)`
  // shape — second pending write would clobber first → token T1
  // commits with K2 → `/share T1` emits K2 → cross-token decryption.
  const pendingKeyName = `${sessionKey}|run:${runId}`;
  const encryptionKey: Buffer = generateKey();

  // Round-2 approved retry semantic: setPending happens BEFORE
  // takeAndRelease. If it throws (FS unwritable / disk full), the
  // logger STAYS in state.sessions — the NEXT agent_end on this
  // sessionKey will auto-retry from scratch with a fresh K. No
  // manual recovery needed.
  try {
    state.keystore.setPending(pendingKeyName, encryptionKey, {
      sessionKey,
      runId,
    });
  } catch (cause) {
    structuredLog(
      "ERROR",
      "agent_end",
      "Keystore setPending failed — aborting encrypted anchor; SessionLogger retained for auto-retry on next agent_end",
      {
        runId,
        pendingKeyName,
        sessionKey,
        cause: cause instanceof Error ? cause.message : String(cause),
        recovery:
          "Fix the keystore FS issue (check ~/.openclaw/verifiable-execution/keystore mode + disk space). " +
          "The SessionLogger remains in state.sessions; the next agent_end on this sessionKey will re-attempt the anchor automatically (no manual operator action required).",
      },
    );
    return;
  }

  // Steps below are all synchronous; no `await` until inside
  // anchorRun's flush call. JS event-loop guarantees no other hook
  // can interleave between takeAndRelease and pendingAnchors.set.
  const logger = state.sessions.takeAndRelease(sessionKey);
  if (logger === null) {
    // Race-impossible defense: we held the `has(sessionKey) === true`
    // contract through the synchronous setPending call, so the slot
    // should still be there. If somehow it isn't (test injection,
    // future hook), structured-log + clean up the pending key file
    // so the keystore isn't littered with orphan AES keys.
    structuredLog(
      "WARN",
      "agent_end",
      "takeAndRelease returned null after has() was true — race-impossible defense path",
      { sessionKey, pendingKeyName },
    );
    return;
  }
  state.pendingAnchors.set(pendingKeyName, logger);

  await anchorRun(
    state,
    logger,
    sessionKey,
    runId,
    pendingKeyName,
    encryptionKey,
    "exec-log",
    "agent_end",
  );
  // v0.3.5: clear per-session run metadata (runStartTime,
  // transcriptPath) now that the turn is fully anchored. The next
  // `message_received` on this sessionKey will set fresh values.
  // Cleanup runs unconditionally (post-success AND post-failure) —
  // pre-flush failure already retained the SessionLogger in
  // state.sessions, and the next agent_end will re-establish runMetadata
  // via the next message_received.
  state.runMetadata.delete(sessionKey);
}

/**
 * session_end handler — v0.3.4 reduces this to ORPHAN RECOVERY.
 *
 * Normal flow: `agent_end` already anchored the logger for the just-
 * completed run and `takeAndRelease` cleared `state.sessions`. The
 * `session_end` hook fires later (channel close, idle timeout,
 * reset, compaction, daily, shutdown — per
 * `PluginHookSessionEndEvent.trigger` at openclaw@2026.5.4
 * plugin-sdk/.../hook-types.d.ts:523) and finds NO logger to anchor
 * — no-op. That's the "one agent task = one token" guarantee.
 *
 * Abnormal flow: the harness died mid-run (process crash, network
 * partition, hard reset) BEFORE `agent_end` fired. `state.sessions`
 * still holds an unflushed logger with the partial turn's entries.
 * Without this branch, those entries die silently in memory. We
 * anchor them with a DISTINCT `dataDescriptionPrefix` of
 * `"exec-log-orphan"` so the dashboard can render a "recovery
 * anchor" badge — operators see the orphan in the feed and know
 * agent_end didn't fire on that token.
 */
export async function handleSessionEnd(
  state: PluginState,
  _event: unknown,
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): Promise<void> {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "session_end", "Skipping orphan check: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }

  // Codex round-2 v0.3.4-6 + round-4 narrowing: defer one microtask
  // so a concurrently-scheduled `handleAgentEnd` runs its synchronous
  // prelude (which `takeAndRelease`s the logger out of state.sessions)
  // FIRST. After the yield, the `state.sessions.has(sessionKey)` check
  // below is the single source of truth:
  //
  //   - has=false → agent_end's prelude already rotated the only
  //     logger (round-2 case: concurrent agent_end + session_end on
  //     the same logger) → no-op.
  //   - has=true  → there's a FRESH logger here, allocated AFTER any
  //     previously-rotated agent_end. This is a genuine orphan and
  //     must be anchored under `exec-log-orphan:`, even if a prior
  //     turn's agent_end is still uploading/minting (round-4 case:
  //     turn N's anchor is in flight; turn N+1 already opened a new
  //     logger; channel closes → recover turn N+1's entries).
  //
  // Earlier revisions used a `state.agentEndInFlight: Set<string>`
  // coordination marker — Codex r4 caught that it was over-broad
  // (would suppress orphan recovery of turn N+1's fresh logger
  // while turn N's mint was still pending). The yield + map-state
  // check pair is strictly simpler AND strictly more correct.
  await Promise.resolve();

  // Gate before keystore write. If no orphan logger exists, this is
  // the common channel-close case — agent_end already anchored and
  // cleared the slot. Silent no-op.
  if (!state.sessions.has(sessionKey)) return;
  // Codex r9: orphan path also needs an entry-count guard so a zero-
  // entry logger (allocated but entry handlers swallowed mid-append)
  // doesn't mint an empty `exec-log-orphan:` receipt at channel close.
  // Same logic as handleAgentEnd above.
  const existingOrphanLogger = state.sessions.getOrCreate(sessionKey);
  if (existingOrphanLogger.getStatus().entryCount === 0) {
    state.sessions.release(sessionKey);
    return;
  }

  // Abnormal path: harness died before agent_end. Use a synthetic
  // recovery runId tagged so it stands out from `anon-*` agent_end
  // fallbacks. ERROR-level log line BEFORE the keystore write so the
  // operator-facing notice fires even if setPending throws.
  const runId = `recovery-${randomBytes(16).toString("hex")}`;
  const pendingKeyName = `${sessionKey}|run:${runId}`;
  structuredLog(
    "ERROR",
    "session_end",
    "Orphan recovery anchor — agent_end never fired for this session",
    {
      runId,
      sessionId: sessionKey,
    },
  );

  const encryptionKey: Buffer = generateKey();
  try {
    state.keystore.setPending(pendingKeyName, encryptionKey, {
      sessionKey,
      runId,
    });
  } catch (cause) {
    // Same retry semantic as handleAgentEnd: logger stays in
    // state.sessions; a subsequent session_end (or a recovered
    // agent_end if the harness comes back) re-attempts the anchor
    // with a fresh K. No manual recovery needed.
    structuredLog(
      "ERROR",
      "session_end",
      "Keystore setPending failed during orphan recovery — SessionLogger retained for auto-retry",
      {
        runId,
        pendingKeyName,
        sessionKey,
        cause: cause instanceof Error ? cause.message : String(cause),
        recovery:
          "Fix the keystore FS issue (check ~/.openclaw/verifiable-execution/keystore mode + disk space). " +
          "The SessionLogger remains in state.sessions; the next session_end on this sessionKey will re-attempt the orphan recovery automatically.",
      },
    );
    return;
  }

  const logger = state.sessions.takeAndRelease(sessionKey);
  if (logger === null) {
    structuredLog(
      "WARN",
      "session_end",
      "takeAndRelease returned null after has() was true — race-impossible defense path",
      { sessionKey, pendingKeyName },
    );
    return;
  }
  state.pendingAnchors.set(pendingKeyName, logger);

  await anchorRun(
    state,
    logger,
    sessionKey,
    runId,
    pendingKeyName,
    encryptionKey,
    "exec-log-orphan",
    "session_end",
  );
  // v0.3.5: orphan-recovery path also clears runMetadata — same
  // semantics as the primary agent_end path.
  state.runMetadata.delete(sessionKey);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read sessionKey from ctx, falling back to sessionId if sessionKey is
 * absent. Per evermemos's groupId-derivation comment, sessionKey is
 * the preferred isolation key because OpenClaw sessions can share the
 * same workspaceDir; sessionId is the fallback.
 */
/**
 * Resolve the canonical key that identifies "this OpenClaw session"
 * across hook phases. Both sessionId and sessionKey exist on
 * OpenClaw's hook contexts but they aren't always populated together
 * (sessionKey is the per-account routing key derived from
 * sessionId + accountId; documented as optional on some contexts).
 *
 * Codex web R4 P2 on PR #20 caught a real bug: this function used to
 * prefer sessionKey. If after_tool_call fired with only sessionId
 * (logger stored under that key) and session_end fired with both
 * sessionId AND sessionKey, the lookup would miss the orphaned
 * logger entirely — silently skipping the anchor + leaving the
 * SessionLogger unreleased.
 *
 * Fix: prefer sessionId. It's the chat-session ID, set the moment a
 * session is created and present on EVERY agent/tool/session hook
 * context. Choosing sessionId guarantees both hook phases resolve to
 * the SAME key for the same session.
 */
function pickSessionKey(ctx: {
  sessionKey?: unknown;
  sessionId?: unknown;
}): string | null {
  if (typeof ctx?.sessionId === "string" && ctx.sessionId.length > 0) {
    return ctx.sessionId;
  }
  if (typeof ctx?.sessionKey === "string" && ctx.sessionKey.length > 0) {
    return ctx.sessionKey;
  }
  return null;
}

/**
 * JSON-roundtrip a value: returns a deep clone via JSON.parse(JSON.stringify(value))
 * IFF the value is safely serializable. Returns `undefined` when JSON.stringify
 * throws (BigInt, circular references) OR returns undefined (top-level
 * function / symbol / undefined).
 *
 * Used to populate the OPTIONAL `params` / `result` fields on
 * ExecutionLogEntry. Hash fields (inputHash / outputHash) are computed
 * separately by sha256Hex, which has its own deterministic fallback for
 * unserializable inputs — so omitting decoded content here doesn't break
 * the proof chain, it just means the dashboard renders "<unserializable>"
 * for that field instead of the decoded value.
 */
function safeJsonRoundtrip(value: unknown): unknown {
  try {
    const stringified = JSON.stringify(value);
    if (stringified === undefined) return undefined;
    return JSON.parse(stringified);
  } catch {
    return undefined;
  }
}

/**
 * Serialize an error for inclusion in outputHash. Captures message +
 * name (Error subclass) + stringified cause where available. Avoids
 * including stack traces — they'd make outputHash unstable across
 * runtimes (different node versions, sourcemaps, etc.).
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(err.cause !== undefined ? { cause: String(err.cause) } : {}),
    };
  }
  return { message: String(err) };
}

// ---------------------------------------------------------------------------
// Plugin export — default OBJECT per OpenClaw contract.
// ---------------------------------------------------------------------------

export default {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: PLUGIN_DESCRIPTION,

  register(api: OpenClawPluginApi): void {
    // Wire OpenClaw's gateway logger BEFORE any structuredLog() calls.
    // Otherwise our log lines go to stderr (silenced at runtime by the
    // gateway — see VPS E2E 2026-05-12 finding). The api.logger
    // interface is documented in openclaw@2026.5.4 plugin-sdk types.
    if (typeof (api as { logger?: PluginLoggerLike }).logger === "object") {
      pluginLogger = (api as { logger: PluginLoggerLike }).logger;
    }

    const resolution = resolveConfig(api.pluginConfig);
    if (!resolution.ok) {
      structuredLog(
        "WARN",
        "register",
        "Plugin loaded in degraded mode: missing required config",
        { missing: resolution.missing, invalid: resolution.invalid },
      );
      api.on("message_received", () => {
        /* noop in degraded mode */
      });
      api.on("before_prompt_build", () => {
        /* noop in degraded mode */
      });
      api.on("after_tool_call", () => {
        /* noop in degraded mode */
      });
      api.on("llm_output", () => {
        /* noop in degraded mode */
      });
      api.on("session_end", () => {
        /* noop in degraded mode */
      });
      api.on("agent_end", () => {
        /* noop in degraded mode */
      });
      // v0.3.5: also register before_agent_finalize so OpenClaw's
      // `plugins inspect` reports a consistent hook set whether the
      // plugin is in degraded mode or live mode. Hook surface stays
      // stable across mode transitions; operators don't see the hook
      // count "drop" when they fix a config issue.
      (api.on as unknown as (
        name: "before_agent_finalize",
        handler: () => void,
      ) => void)("before_agent_finalize", () => {
        /* noop in degraded mode */
      });
      return;
    }

    let state: PluginState;
    try {
      state = buildPluginState(resolution.config);
    } catch (cause) {
      // Most likely: PRIVATE_KEY env var unset. Plugin stays
      // installable but operates as no-op until the env is wired.
      structuredLog(
        "WARN",
        "register",
        "Plugin loaded in degraded mode: failed to build runtime state",
        { cause: cause instanceof Error ? cause.message : String(cause) },
      );
      api.on("message_received", () => {
        /* noop in degraded mode */
      });
      api.on("before_prompt_build", () => {
        /* noop in degraded mode */
      });
      api.on("after_tool_call", () => {
        /* noop in degraded mode */
      });
      api.on("llm_output", () => {
        /* noop in degraded mode */
      });
      api.on("session_end", () => {
        /* noop in degraded mode */
      });
      api.on("agent_end", () => {
        /* noop in degraded mode */
      });
      // v0.3.5: also register before_agent_finalize so OpenClaw's
      // `plugins inspect` reports a consistent hook set whether the
      // plugin is in degraded mode or live mode. Hook surface stays
      // stable across mode transitions; operators don't see the hook
      // count "drop" when they fix a config issue.
      (api.on as unknown as (
        name: "before_agent_finalize",
        handler: () => void,
      ) => void)("before_agent_finalize", () => {
        /* noop in degraded mode */
      });
      return;
    }

    // ── Capture hooks ─────────────────────────────────────────────────────
    // v0.2.0 evermemos-style capture set (5 hooks):
    //   message_received    → user_input entry (what did the user ask?)
    //   before_prompt_build → prompt_build entry (which model/provider?)
    //   llm_output          → parsed into reasoning / tool_use / llm_text
    //   after_tool_call     → tool_result entry per OpenClaw-dispatched tool
    //   session_end / agent_end → flush + mint
    //
    // This combination covers BOTH OpenClaw-dispatched tools (Brave search,
    // Firecrawl) AND agents that handle tools internally (Claude Code's
    // bash/edit/grep that never surface to OpenClaw). Reference plugin:
    // evermemos at /tmp/0g-memory-fresh/openclaw-skills/evermemos/src/index.ts
    // uses the same 5-hook set.
    api.on("message_received", (event, ctx) => {
      handleMessageReceived(state, event, ctx);
    });
    api.on("before_prompt_build", (event, ctx) => {
      handleBeforePromptBuild(state, event, ctx);
    });
    api.on("after_tool_call", (event, ctx) => {
      handleAfterToolCall(state, event, ctx);
    });
    api.on("llm_output", (event, ctx) => {
      handleLlmOutput(state, event, ctx);
    });

    // v0.3.5 — capture Claude Code's transcriptPath from
    // before_agent_finalize. Required for surfacing claude-cli's
    // INTERNAL tool calls (Read, WebSearch, Bash, Edit, MCP) in the
    // receipt: those tools don't fire after_tool_call (they run inside
    // the Claude Code subprocess, never reaching OpenClaw's dispatcher).
    // The transcriptPath lets handleAgentEnd parse claude-cli's session
    // jsonl at anchor time and inject one entry per tool_use block.
    //
    // Cast required because before_agent_finalize is NEW in v0.3.5 and
    // our SDK overload doesn't enumerate it yet. The runtime accepts
    // any registered hook name string per OpenClaw 2026.4.25+
    // hook-runner-global.
    (api.on as unknown as (
      name: "before_agent_finalize",
      handler: (
        event: { transcriptPath?: unknown; runId?: unknown },
        ctx: { sessionKey?: unknown; sessionId?: unknown },
      ) => { action: "continue" } | void,
    ) => void)("before_agent_finalize", (event, ctx) => {
      handleBeforeAgentFinalize(state, event, ctx);
      // Return continue so we don't gate finalization.
      return { action: "continue" };
    });

    // ── Anchor hooks ──────────────────────────────────────────────────────
    // session_end fires when a channel session closes (Telegram/Discord
    // thread ends, idle timeout). agent_end fires after every agent run
    // — more reliable for autonomous agents and CLI backends. Whichever
    // fires first for a sessionKey performs the anchor; the second one
    // finds the SessionLogger released and no-ops cleanly (handleSessionEnd
    // checks `state.sessions.has(sessionKey)` before doing any work).
    api.on("session_end", async (event, ctx) => {
      await handleSessionEnd(state, event, ctx);
    });
    api.on("agent_end", async (event, ctx) => {
      await handleAgentEnd(state, event, ctx);
    });

    // v0.3.0: /share slash command. Operator-facing UX for delivering
    // share URLs WITHOUT polluting every agent reply (Abu's UX critique
    // 2026-05-12). Pattern mirrors stock `codex` plugin —
    // /tmp/openclaw-src/extensions/codex/index.ts:32-38.
    //
    // registerCommand auto-registers the slash command with channel
    // providers (Telegram bot menu, Discord slash commands, CLI tab
    // complete). The inbound_claim handler fires when the runtime
    // routes a matching inbound to us.
    //
    // Wrapped in try/catch so a runtime missing registerCommand (older
    // OpenClaw versions or non-standard channel providers) doesn't
    // crash the whole plugin load — degrades to "inbound_claim
    // listener only" which still works on channels that pass `/share`
    // as a regular message + set commandAuthorized=true based on
    // text prefix matching.
    try {
      // OpenClaw's registerCommand expects an OpenClawPluginCommandDefinition
      // shape per /tmp/openclaw-src/src/plugins/types.ts:2000. VPS round-2
      // (2026-05-13) caught that the v0.3.1 minimal shape (name +
      // description + handler) registered the command in OpenClaw's
      // internal registry but DIDN'T propagate to Telegram's
      // setMyCommands surface — `/share` never appeared in the bot menu
      // and typing it manually was treated as plain text. Two missing
      // fields were the issue:
      //   - `nativeNames: { default: "share" }` — opt-in to native
      //     command surfaces (Telegram menu, Discord slash, CLI tab)
      //   - `acceptsArgs: true` — so "/share 64" parses the "64" as
      //     ctx.args instead of dropping the arg
      //
      // The handler signature is PluginCommandContext (NOT the
      // inbound_claim event shape) per types.ts:1993. ctx already
      // carries the authorization result + args, so we adapt the
      // ctx → ShareCommandEvent shape for handleShareCommand and
      // pass `commandAuthorized: true` because OpenClaw won't invoke
      // this handler unless its own per-command auth gate passed
      // (line 437 of telegram bot-8OTlBs39.js — rejectNotAuthorized
      // fires BEFORE our handler).
      interface PluginCommandContextLike {
        isAuthorizedSender?: boolean;
        args?: string;
        commandBody?: string;
      }
      type CommandHandler = (
        ctx: PluginCommandContextLike,
      ) => { text: string; continueAgent?: boolean } | Promise<{ text: string; continueAgent?: boolean }>;
      type RegisterCommandFn = (cmd: {
        name: string;
        description: string;
        nativeNames?: { default?: string };
        acceptsArgs?: boolean;
        requireAuth?: boolean;
        handler: CommandHandler;
      }) => void;
      const reg = (
        api as unknown as { registerCommand?: RegisterCommandFn }
      ).registerCommand;
      if (typeof reg === "function") {
        reg.call(api, {
          name: "share",
          // nativeNames pin: same on every native command surface.
          nativeNames: { default: "share" },
          description:
            "Get a verifiable receipt URL for your last agent action (or `/share <tokenId>`).",
          // /share takes an optional tokenId argument.
          acceptsArgs: true,
          handler: (ctx) => {
            // Synthesize a ShareCommandEvent for handleShareCommand.
            // commandAuthorized is true by construction (OpenClaw
            // already authorized; this handler wouldn't run otherwise).
            const argsArr =
              typeof ctx.args === "string" && ctx.args.trim().length > 0
                ? [ctx.args.trim()]
                : undefined;
            const result = handleShareCommand(
              {
                keystore: state.keystore,
                verifyUrlBase: state.config.verifyUrlBase,
              },
              {
                content: ctx.commandBody ?? "/share",
                commandAuthorized: true,
                args: argsArr,
              },
            );
            // PluginCommandResult requires { text }. If our handler
            // returns no reply (handled:false), surface a generic
            // diagnostic — but that shouldn't happen given we
            // already validated commandAuthorized + content above.
            return { text: result.reply?.text ?? "/share: no reply produced" };
          },
        });
      }
    } catch (cause) {
      structuredLog("WARN", "register", "registerCommand(share) failed; falling back to inbound_claim text-match only", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    // api.on() is overloaded by event name; the inbound_claim variant
    // expects a different ctx than the message hooks we already use.
    // Cast through a permissive intersection so TS picks the right
    // overload without us depending on internal SDK types.
    (api.on as unknown as (
      name: "inbound_claim",
      handler: (event: {
        content?: unknown;
        commandAuthorized?: unknown;
        args?: unknown;
      }) => { handled: boolean; reply?: { text: string } } | undefined,
    ) => void)("inbound_claim", (event) => {
      // SECURITY (Codex round-6 + round-13 final): require BOTH
      // commandAuthorized === true AND content.startsWith("/share").
      //
      // After cross-checking the OpenClaw SDK type
      // (/tmp/openclaw-src/src/plugins/hook-message.types.ts:26),
      // PluginHookInboundClaimEvent has NO `command` / `commandName`
      // field — only `content`, `body`, `bodyForAgent`, and
      // `commandAuthorized`. The stock codex plugin
      // (/tmp/openclaw-src/extensions/codex/src/conversation-binding.ts:143)
      // discriminates via `ctx.pluginBinding`, which we haven't wired
      // up. Without it, OpenClaw can dispatch ANY authorized inbound
      // to ALL plugins that registered an inbound_claim listener —
      // and `handleShareCommand` falls back to `getLast()` when no
      // args/content are present, leaking the most-recent receipt's
      // share URL to a stranger sending `/upload` etc.
      //
      // Round-11 round-tripped through "trust the runtime" based on
      // pattern-matching the stock plugin; round-13 caught the
      // real-world implication. Restoring the content gate:
      //
      // Trade-off: Discord-style channels that pre-split slash-command
      // args without raw content are NOT supported in v0.3.0 — they
      // must ALSO pass `content: "/share"`. handleShareCommand's
      // `event.args[0]` parser still runs once routed here, so an
      // event with `content: "/share"` AND `args: ["42"]` works.
      if (event.commandAuthorized !== true) return { handled: false };
      const isShareCommand =
        typeof event.content === "string" &&
        /^\s*\/share(\s|$)/i.test(event.content);
      if (!isShareCommand) return { handled: false };
      return handleShareCommand(
        {
          keystore: state.keystore,
          verifyUrlBase: state.config.verifyUrlBase,
        },
        event,
      );
    });

    structuredLog("INFO", "register", "Plugin loaded with full runtime state", {
      chainId: state.config.chainId,
      agentId: state.config.agentId,
      verifyUrlBase: state.config.verifyUrlBase,
    });
  },
};
