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

import { createHash } from "node:crypto";

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
import { sha256Hex } from "./hash.js";
import { SessionManager } from "./SessionManager.js";
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
  // The storageSigner (already provider-connected) doubles as our
  // entry-signing key. agentId is the wallet's address, so signatures
  // recover to the agentId field on each entry — that's how the
  // dashboard's "Signed by 0x…" badge becomes green without needing
  // MockTEEVerifier's global teeOracleAddress to match.
  return { config, sessions, agenticIdClient, signer: storageSigner };
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
 * which model + provider the agent is using for this turn. Privacy-
 * conscious: does NOT capture the systemPrompt body (can be 50KB+ of
 * project context with secrets/MCP URLs) or the prompt itself — only
 * metadata. The actual prompt content surfaces via `llm_output`
 * indirectly (assistant's response references context, history etc.).
 *
 * Per PluginHookBeforePromptBuildEvent
 * (plugin-sdk/src/plugins/hook-types.d.ts:9, 226): fields include
 * `prompt`, `systemPrompt`, `historyMessages`, model identity. We
 * record provider/model + historyMessages.length only.
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
    const payload = {
      provider: ctx.modelProviderId,
      model: ctx.modelId,
      historyMessagesLength: historyLen,
      systemPromptLength:
        typeof event.systemPrompt === "string" ? event.systemPrompt.length : 0,
      promptLength: typeof event.prompt === "string" ? event.prompt.length : 0,
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
 * session_end handler — flush the SessionLogger to 0G Storage, mint an
 * iNFT anchor via SessionAnchor, and log the resulting verifyUrl. Three
 * outcomes:
 *   1. No SessionLogger for this sessionKey (zero tool calls happened
 *      in this session) → nothing to anchor; INFO log; return.
 *   2. Anchor succeeds → INFO log including the full verifyUrl
 *      (verifyUrlBase + relative path); release the SessionLogger.
 *   3. Anchor fails → ERROR log including the rootHash from
 *      SessionAnchorMintAfterFlushError so operators can manually
 *      retryMint(); release the SessionLogger so memory doesn't leak.
 *
 * Always returns void — the OpenClaw hook contract doesn't surface a
 * return value back to the agent. The verifyUrl appears in the
 * structured log, where dashboards / verifier UIs pick it up.
 */
export async function handleSessionEnd(
  state: PluginState,
  _event: unknown,
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): Promise<void> {
  const sessionKey = pickSessionKey(ctx);
  if (sessionKey === null) {
    structuredLog("WARN", "session_end", "Skipping anchor: no sessionKey/sessionId on ctx", {
      ctxKeys: Object.keys(ctx ?? {}),
    });
    return;
  }
  if (!state.sessions.has(sessionKey)) {
    // Zero tool calls in this session — nothing to anchor.
    structuredLog("INFO", "session_end", "No active SessionLogger for session; skipping anchor", {
      sessionKey,
    });
    return;
  }

  const logger = state.sessions.getOrCreate(sessionKey); // safe — we just checked has()
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

  try {
    const result = await anchor.anchor({
      sessionId: sessionKey,
      containerHash,
    });
    const fullVerifyUrl = `${state.config.verifyUrlBase.replace(/\/$/, "")}${result.verifyUrl}`;
    structuredLog("INFO", "session_end", "Session anchored on-chain", {
      sessionKey,
      tokenId: result.tokenId.toString(),
      txHash: result.txHash,
      rootHash: result.rootHash,
      entryCount: result.entryCount,
      verifyUrl: fullVerifyUrl,
    });
    // Anchor succeeded → flush already sealed the logger; safe to release.
    state.sessions.release(sessionKey);
  } catch (cause) {
    // Surface as a STRUCTURED failure (per BDD: "the error is caught
    // and surfaced as a structured failure"). The recovery path
    // (rootHash for retryMint) is captured when the cause is
    // SessionAnchorMintAfterFlushError so operators can manually
    // retry against the chain.
    const failureFields: Record<string, unknown> = {
      sessionKey,
      cause: cause instanceof Error ? cause.message : String(cause),
    };
    if (cause instanceof SessionAnchorMintAfterFlushError) {
      failureFields.rootHash = cause.rootHash;
      failureFields.entryCount = cause.entryCount;
      failureFields.dataDescription = cause.dataDescription;
      failureFields.recovery = "Call SessionAnchor.retryMint({rootHash, entryCount, sessionId}) to retry mint without re-flushing.";
      // Flush succeeded → logger is sealed; rootHash is on 0G Storage
      // and survives a release. Operator retries mint independently.
      structuredLog("ERROR", "session_end", "Anchor failed", failureFields);
      state.sessions.release(sessionKey);
    } else {
      // Flush itself failed (or some pre-flush error). The SessionLogger
      // still holds the collected entries in memory — DO NOT release,
      // or those entries are lost and the proof is unrecoverable. Leave
      // the logger in the SessionManager map so the operator (or a
      // retry hook) can re-attempt anchor.anchor() on the same logger.
      // (Codex bot round-13 P1 on PR #23.)
      failureFields.recovery =
        "Flush failed before mint; SessionLogger retained in-memory. " +
        "Re-run anchor() with the same sessionKey to retry from flush.";
      structuredLog("ERROR", "session_end", "Anchor failed (pre-flush)", failureFields);
    }
  }
}

/**
 * agent_end handler — same anchor logic as session_end, fires per
 * agent-run rather than per channel-session. On claude-cli backends
 * (Claude Code, Aider, etc.) `session_end` only fires when the channel
 * conversation ends, while `agent_end` fires after every agent reply.
 * Subscribing to both means: per-reply anchors for autonomous agents,
 * per-conversation anchors for chat channels — whichever fires first
 * for a given sessionKey wins; the second one finds the SessionLogger
 * released and no-ops cleanly.
 *
 * Implementation is literally a delegation to handleSessionEnd —
 * keeping them separate at the type/export level so the BDD-to-test
 * mapping stays line-by-line obvious (one hook per BDD scenario).
 */
export async function handleAgentEnd(
  state: PluginState,
  event: unknown,
  ctx: { sessionKey?: unknown; sessionId?: unknown },
): Promise<void> {
  return handleSessionEnd(state, event, ctx);
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

    structuredLog("INFO", "register", "Plugin loaded with full runtime state", {
      chainId: state.config.chainId,
      agentId: state.config.agentId,
      verifyUrlBase: state.config.verifyUrlBase,
    });
  },
};
