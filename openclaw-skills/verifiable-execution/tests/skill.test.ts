/**
 * Tests for openclaw-skills/verifiable-execution/src/index.ts (story-skill-init).
 *
 * BDD acceptance from context/docs/stories/story-skill-init.md (post-spec-evolution):
 *   - Default export is an OBJECT with {id, name, description, register}
 *     — NOT a default function activate(api). (The original BDD had this
 *     wrong; story updated to match the real OpenClaw API per
 *     0g-memory/openclaw-skills/evermemos and the SDK type definitions
 *     in openclaw@2026.5.4 plugin-sdk/src/plugins/types.d.ts:1886.)
 *   - register(api) reads pluginConfig + degrades gracefully on missing config
 *   - register(api) wires after_tool_call + session_end hooks via api.registerHook
 *   - Plugin never crashes the host on missing config (logs structured warning instead)
 *
 * Strategy: build a minimal fake OpenClawPluginApi with vi.fn spies for
 * registerHook + a mutable pluginConfig field so tests can exercise both
 * the happy-path and degraded-mode branches without standing up the full
 * OpenClaw runtime (which is the entire 74MB openclaw npm package).
 */

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Wallet, keccak256, recoverAddress, toUtf8Bytes } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  SessionLogger,
  StorageClient,
  type IndexerLike,
} from "@verifiable-agent-execution/logger";
import {
  AgenticIDClient,
  SessionAnchorMintAfterFlushError,
  type AgenticIDContractLike,
  type IntelligentData,
  type MintResult,
} from "@verifiable-agent-execution/chain-client";

import plugin, {
  handleAfterToolCall,
  handleAgentEnd,
  handleBeforePromptBuild,
  handleLlmOutput,
  handleMessageReceived,
  handleSessionEnd,
  parseAssistantBlocks,
} from "../src/index.js";
import { resolveConfig, type VerifiableExecutionConfig } from "../src/config.js";
import { sha256Hex } from "../src/hash.js";
import { Keystore } from "../src/keystore.js";
import { SessionManager } from "../src/SessionManager.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_AGENT_ADDRESS = `0x${"a".repeat(40)}`;
const VALID_AGENTICID_ADDRESS = "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
const VALID_VERIFIER_ADDRESS = `0x${"b".repeat(40)}`;

const FULL_CONFIG: Record<string, unknown> = {
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  agenticIdAddress: VALID_AGENTICID_ADDRESS,
  verifierAddress: VALID_VERIFIER_ADDRESS,
  verifyUrlBase: "https://verify.example.com",
  chainId: 16602,
  agentId: VALID_AGENT_ADDRESS,
  modelId: "claude-sonnet-4-6",
  // privateKeyEnvVar omitted — defaults to "PRIVATE_KEY"
};

/**
 * Build a fake OpenClawPluginApi minimal enough to drive register()
 * without typing the full 100+-method OpenClawPluginApi surface.
 * The cast through `unknown` is the conventional ethers-test-double
 * pattern in this repo (see chain-client tests for the same shape).
 */
function makeFakeApi(pluginConfig?: Record<string, unknown>): {
  api: Parameters<typeof plugin.register>[0];
  onSpy: ReturnType<typeof vi.fn>;
} {
  const onSpy = vi.fn();
  const api = {
    id: plugin.id,
    name: plugin.name,
    pluginConfig,
    on: onSpy,
    // The remaining OpenClawPluginApi methods are intentionally absent
    // — register() only touches `on` + pluginConfig, so the fake stays
    // small.
  } as unknown as Parameters<typeof plugin.register>[0];
  return { api, onSpy };
}

// ---------------------------------------------------------------------------
// Plugin shape (BDD: default export is OBJECT with {id, name, description, register})
// ---------------------------------------------------------------------------

describe("verifiable-execution plugin — shape", () => {
  it("exports an object with the OpenClaw-required {id, name, description, register} fields", () => {
    expect(plugin.id).toBe("verifiable-execution");
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name.length).toBeGreaterThan(0);
    expect(typeof plugin.description).toBe("string");
    expect(typeof plugin.register).toBe("function");
  });

  it("does NOT export a default function (rejects the original BDD's `activate(api)` shape)", () => {
    // Spec evolution: the original story-skill-init BDD used Claude
    // Code skill conventions (`export default function activate(api)`)
    // which doesn't match OpenClaw's actual plugin contract. This
    // test pins the corrected shape.
    expect(typeof plugin).not.toBe("function");
    expect(plugin).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      register: expect.any(Function),
    });
  });
});

// ---------------------------------------------------------------------------
// register() — happy path
// ---------------------------------------------------------------------------

describe("register() — happy path with full config", () => {
  it("registers all 7 hooks via api.on (v0.3.0: + inbound_claim for /share)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);

    // v0.3.0: 7 hooks.
    //   Capture (4): message_received, before_prompt_build,
    //                after_tool_call, llm_output
    //   Anchor (2):  session_end, agent_end
    //   Command (1): inbound_claim — routes /share to handleShareCommand
    expect(onSpy).toHaveBeenCalledTimes(7);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining([
        "message_received",
        "before_prompt_build",
        "after_tool_call",
        "llm_output",
        "session_end",
        "agent_end",
        "inbound_claim",
      ]),
    );
  });

  it("hook handlers are functions (the test fixtures, not undefined)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);

    for (const call of onSpy.mock.calls) {
      const handler = call[1];
      expect(typeof handler).toBe("function");
    }
  });

  it("does not throw on a fully valid config", () => {
    const { api } = makeFakeApi(FULL_CONFIG);
    expect(() => plugin.register(api)).not.toThrow();
  });
});

// Codex round-6 P1: inbound_claim handler authorization gate.
//
// Earlier revisions accepted ANY inbound text starting with "/share"
// (text-prefix fallback for older OpenClaw runtimes without
// commandAuthorized). That bypassed operator-identity check — an
// untrusted channel sender could fire /share and receive a reveal URL.
// Hardened: require event.commandAuthorized === true mandatorily.
describe("register() — inbound_claim authorization gate", () => {
  // Drive the registered handler directly by capturing it from the
  // api.on spy and invoking with a synthetic event.
  function getInboundClaimHandler(
    onSpy: ReturnType<typeof makeFakeApi>["onSpy"],
  ): (event: {
    content?: unknown;
    commandAuthorized?: unknown;
    args?: unknown;
  }) => { handled: boolean; reply?: { text: string } } | undefined {
    const call = onSpy.mock.calls.find((c) => c[0] === "inbound_claim");
    if (!call) throw new Error("inbound_claim handler not registered");
    return call[1] as never;
  }

  it("rejects /share text when commandAuthorized is undefined (no operator auth → no leak)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({ content: "/share" }) ?? { handled: false };
    expect(result.handled).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("rejects /share text when commandAuthorized is explicitly false", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({ content: "/share 42", commandAuthorized: false }) ?? {
      handled: false,
    };
    expect(result.handled).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("accepts /share when commandAuthorized is true (operator-authenticated path)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    // No receipts yet — handleShareCommand returns the friendly
    // "no receipts" reply. Important: result.handled is true, so the
    // gate let it through.
    const result = handler({ content: "/share", commandAuthorized: true });
    expect(result?.handled).toBe(true);
    expect(result?.reply?.text).toMatch(/no receipts yet/i);
  });

  // Codex round-13 FINAL (this is round 7 of the args-only oscillation):
  // The SDK type PluginHookInboundClaimEvent
  // (/tmp/openclaw-src/src/plugins/hook-message.types.ts:26) has NO
  // command/commandName field. OpenClaw can dispatch any authorized
  // inbound to ALL plugins listening on inbound_claim; the stock
  // codex plugin discriminates via ctx.pluginBinding (which we don't
  // wire up). Without that signal, handleShareCommand falls through
  // to getLast() and would leak the most-recent receipt's URL to a
  // stranger typing /upload, /summarize, etc.
  //
  // Restored: text content gate (`/^\s*\/share/i`). Discord-style
  // pre-split args without raw content are unsupported in v0.3.0 —
  // channels must also pass `content: "/share"` or `"/share <id>"`.
  it("rejects an authorized non-/share inbound (defense in depth: no last-receipt leak via /upload etc.)", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({
      content: "/upload file.png",
      commandAuthorized: true,
      args: ["file.png"],
    }) ?? { handled: false };
    expect(result.handled).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("rejects an authorized event with args[] only (no /share content) — args-only Discord shape unsupported in v0.3.0", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({
      commandAuthorized: true,
      args: ["42"],
    }) ?? { handled: false };
    expect(result.handled).toBe(false);
    expect(result.reply).toBeUndefined();
  });

  it("accepts /share <tokenId> when content is present AND args are pre-split", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({
      content: "/share 42",
      commandAuthorized: true,
      args: ["42"],
    });
    expect(result?.handled).toBe(true);
    // No key for tokenId 42 in fresh keystore → friendly reply.
    expect(result?.reply?.text).toMatch(/No key on this host for tokenId 42/i);
  });

});

// ---------------------------------------------------------------------------
// register() — degraded mode (BDD: missing config logs warning, NOT crashes)
// ---------------------------------------------------------------------------

describe("register() — degraded mode on missing config", () => {
  it("does not throw when pluginConfig is undefined", () => {
    const { api } = makeFakeApi(undefined);
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("does not throw when pluginConfig is empty object", () => {
    const { api } = makeFakeApi({});
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("still registers all 7 hooks in degraded mode (so OpenClaw sees the plugin as healthy)", () => {
    const { api, onSpy } = makeFakeApi({});
    plugin.register(api);
    // v0.3.0: 7 hooks (same as happy path — config defaults make even
    // {} a valid config). Empty-config still hits the full register
    // path because resolveConfig fills Galileo defaults.
    expect(onSpy).toHaveBeenCalledTimes(7);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining([
        "message_received",
        "before_prompt_build",
        "after_tool_call",
        "llm_output",
        "session_end",
        "agent_end",
        "inbound_claim",
      ]),
    );
  });

  it("does not throw when pluginConfig has only some fields filled in", () => {
    const partial = {
      rpcUrl: FULL_CONFIG.rpcUrl,
      indexerUrl: FULL_CONFIG.indexerUrl,
      // intentionally missing the rest
    };
    const { api } = makeFakeApi(partial);
    expect(() => plugin.register(api)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveConfig() — direct config-shape coverage (consumed by register())
// ---------------------------------------------------------------------------

describe("resolveConfig — config validation", () => {
  it("returns ok=true with no defaults applied when full config is supplied", () => {
    const result = resolveConfig(FULL_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.privateKeyEnvVar).toBe("PRIVATE_KEY");
      expect(result.config.chainId).toBe(16602);
      expect(result.config.agentId).toBe(VALID_AGENT_ADDRESS);
      expect(result.appliedDefaults).toEqual([]);
    }
  });

  it("fills every field with Galileo testnet defaults when config is empty", () => {
    // 0.1.1: every field is optional; missing fields fall back to the
    // baked-in Galileo defaults. agentId is a special case — it stays
    // empty string here and gets filled from the wallet by the plugin
    // entry (so `appliedDefaults` still includes 'agentId' as a flag).
    const result = resolveConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.rpcUrl).toBe("https://evmrpc-testnet.0g.ai");
      expect(result.config.indexerUrl).toBe(
        "https://indexer-storage-testnet-turbo.0g.ai",
      );
      expect(result.config.agenticIdAddress).toBe(
        "0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38",
      );
      expect(result.config.verifierAddress).toBe(
        "0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad",
      );
      expect(result.config.verifyUrlBase).toBe("https://verifiable.0g.ai");
      expect(result.config.chainId).toBe(16602);
      expect(result.config.modelId).toBe("claude-sonnet-4-6");
      expect(result.config.agentId).toBe(""); // filled from wallet downstream
      expect(result.appliedDefaults).toEqual(
        expect.arrayContaining([
          "rpcUrl",
          "indexerUrl",
          "agenticIdAddress",
          "verifierAddress",
          "verifyUrlBase",
          "chainId",
          "agentId",
          "modelId",
        ]),
      );
    }
  });

  it("treats zero-address agentId as unset (defaults to wallet downstream)", () => {
    const result = resolveConfig({
      ...FULL_CONFIG,
      agentId: "0x0000000000000000000000000000000000000000",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.agentId).toBe("");
      expect(result.appliedDefaults).toContain("agentId");
    }
  });

  it("flags malformed addresses as 'invalid' (overrides must be valid)", () => {
    const result = resolveConfig({
      ...FULL_CONFIG,
      agentId: "not-an-address",
      agenticIdAddress: "0xtoo-short",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid.some((s) => s.includes("agentId"))).toBe(true);
      expect(result.invalid.some((s) => s.includes("agenticIdAddress"))).toBe(true);
    }
  });

  it("uses a custom privateKeyEnvVar when supplied", () => {
    const result = resolveConfig({
      ...FULL_CONFIG,
      privateKeyEnvVar: "GALILEO_TESTNET_PRIVATE_KEY",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.privateKeyEnvVar).toBe("GALILEO_TESTNET_PRIVATE_KEY");
    }
  });

  it("rejects an explicitly-provided bad chainId (but accepts missing)", () => {
    // Bad values: non-integer / zero / negative / string → invalid bucket.
    for (const bad of [0, -1, 1.5, "16602"]) {
      const result = resolveConfig({ ...FULL_CONFIG, chainId: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.invalid.some((s) => s.includes("chainId"))).toBe(true);
      }
    }
    // Missing / null → default (no error).
    for (const absent of [undefined, null]) {
      const { chainId: _drop, ...rest } = FULL_CONFIG;
      const result = resolveConfig(
        absent === undefined ? rest : { ...rest, chainId: absent },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.chainId).toBe(16602);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// State builders for the hook handlers — these stand up a real
// SessionLogger + a stubbed AgenticIDClient.mint so the handlers can be
// driven without standing up 0G Storage or the chain. Same test-double
// strategy as packages/chain-client/tests/session-anchor.test.ts.
// ---------------------------------------------------------------------------

const ROOT_HASH = `0x${"f".repeat(64)}`;
const MINT_TX_HASH = `0x${"d".repeat(64)}`;
const MINT_TOKEN_ID = 99n;

function buildResolvedConfig(
  overrides: Partial<VerifiableExecutionConfig> = {},
): VerifiableExecutionConfig {
  const result = resolveConfig(FULL_CONFIG);
  if (!result.ok) throw new Error("FULL_CONFIG should resolve");
  return { ...result.config, ...overrides };
}

function buildStorageClient(opts?: {
  uploadOverride?: IndexerLike["upload"];
}): StorageClient {
  const indexer: IndexerLike = {
    upload:
      opts?.uploadOverride ??
      ((async () => [
        { rootHash: ROOT_HASH, txHash: `0x${"b".repeat(64)}`, txSeq: 0 },
        null,
      ]) as unknown as IndexerLike["upload"]),
    downloadToBlob: (async () => {
      throw new Error("downloadToBlob not configured");
    }) as unknown as IndexerLike["downloadToBlob"],
  };
  return new StorageClient({
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    signer: new Wallet(`0x${"1".repeat(64)}`),
    indexer,
  });
}

function buildAgenticIdClient(opts?: {
  mintImpl?: (
    to: string,
    datas: ReadonlyArray<IntelligentData>,
    confirmations?: number,
  ) => Promise<MintResult>;
}): { client: AgenticIDClient; mintSpy: ReturnType<typeof vi.fn> } {
  // Real AgenticIDClient with a stubbed `mint` method (same pattern as
  // session-anchor.test.ts buildAgenticIdClient — bypasses the receipt
  // path so we can isolate hook orchestration).
  const contract: AgenticIDContractLike = {
    iMint: vi.fn() as unknown as AgenticIDContractLike["iMint"],
    getIntelligentDatas: (async () => []) as unknown as AgenticIDContractLike["getIntelligentDatas"],
  };
  const client = new AgenticIDClient(
    VALID_AGENTICID_ADDRESS,
    undefined,
    undefined,
    { contract },
  );
  const mintImpl =
    opts?.mintImpl ??
    (async () => ({ tokenId: MINT_TOKEN_ID, txHash: MINT_TX_HASH }));
  const mintSpy = vi.fn(mintImpl);
  client.mint = mintSpy as unknown as AgenticIDClient["mint"];
  return { client, mintSpy };
}

function buildPluginStateForTests(opts?: {
  configOverrides?: Partial<VerifiableExecutionConfig>;
  uploadOverride?: IndexerLike["upload"];
  mintImpl?: (
    to: string,
    datas: ReadonlyArray<IntelligentData>,
    confirmations?: number,
  ) => Promise<MintResult>;
  signerPrivateKey?: string;
}) {
  const config = buildResolvedConfig(opts?.configOverrides);
  const storageClient = buildStorageClient({ uploadOverride: opts?.uploadOverride });
  const sessions = new SessionManager({ storageClient });
  const { client: agenticIdClient, mintSpy } = buildAgenticIdClient({
    mintImpl: opts?.mintImpl,
  });
  // Deterministic test signer (privkey defaults to 0x...01). Override
  // via opts.signerPrivateKey when a test cares that signer.address
  // matches config.agentId (signature-verification tests).
  const signer = new Wallet(
    opts?.signerPrivateKey ??
      "0x0000000000000000000000000000000000000000000000000000000000000001",
  );
  // Per-test ephemeral keystore so writes don't touch the real
  // ~/.openclaw/. Goes into the OS tmpdir and is leaked at process exit
  // (vitest sandboxes give a fresh dir per worker).
  const keystoreRoot = mkdtempSync(join(tmpdir(), "ve-test-keystore-"));
  const keystore = new Keystore({ root: keystoreRoot });
  // v0.3.4: retry registry for un-flushed loggers. Empty per-test —
  // most tests exercise the happy path where flush succeeds and the
  // registry never accumulates entries; the pre-flush-failure test
  // observes its contents directly.
  const pendingAnchors = new Map<string, SessionLogger>();
  return {
    state: {
      config,
      sessions,
      agenticIdClient,
      signer,
      keystore,
      pendingAnchors,
    },
    mintSpy,
  };
}

// ---------------------------------------------------------------------------
// handleAfterToolCall — story-skill-intercept
// ---------------------------------------------------------------------------

describe("handleAfterToolCall — story-skill-intercept", () => {
  it("appends one ExecutionLogEntry per tool call with the right shape", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_intercept_01";

    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "0G chain" }, result: { hits: 3 } },
      { sessionKey },
    );

    const logger = state.sessions.getOrCreate(sessionKey);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seq: 0,
      type: "tool_call",
      tool: "web_search",
      inputHash: sha256Hex({ q: "0G chain" }),
      outputHash: sha256Hex({ hits: 3 }),
    });
    expect(typeof entries[0].ts).toBe("number");
  });

  it("3 sequential tool calls produce 3 entries with monotonic seq (0, 1, 2)", () => {
    // BDD: "Given 3 tool calls are executed in a session, when the
    // session is inspected mid-run, then SessionLogger has 3 entries
    // in order".
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_intercept_seq";

    for (let i = 0; i < 3; i++) {
      handleAfterToolCall(
        state,
        { toolName: `tool_${i}`, params: { i }, result: { ok: true, i } },
        { sessionKey },
      );
    }

    const logger = state.sessions.getOrCreate(sessionKey);
    const entries = logger.getEntries();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(entries.map((e) => e.tool)).toEqual(["tool_0", "tool_1", "tool_2"]);
  });

  it("captures tool errors as a tool_call entry with error envelope in outputHash (BDD: error does not crash session)", () => {
    // Logger schema doesn't have a tool_error type — story acknowledges
    // capturing the error in outputHash via {error} envelope is the
    // non-invasive equivalent.
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_intercept_err";
    const failingErr = new Error("tool timeout: exceeded 30s deadline");

    handleAfterToolCall(
      state,
      { toolName: "summarize", params: { input: "long…" }, error: failingErr },
      { sessionKey },
    );

    const logger = state.sessions.getOrCreate(sessionKey);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("tool_call");
    expect(entries[0].outputHash).toBe(
      sha256Hex({
        error: { name: "Error", message: "tool timeout: exceeded 30s deadline" },
      }),
    );
  });

  it("skips entry (no crash) when ctx has neither sessionKey nor sessionId", () => {
    const { state } = buildPluginStateForTests();
    expect(() =>
      handleAfterToolCall(
        state,
        { toolName: "web_search", params: {}, result: {} },
        {},
      ),
    ).not.toThrow();
    expect(state.sessions.size()).toBe(0);
  });

  it("falls back to ctx.sessionId when sessionKey is absent", () => {
    const { state } = buildPluginStateForTests();
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionId: "ses_via_id_only" },
    );
    expect(state.sessions.has("ses_via_id_only")).toBe(true);
  });

  it("uses '<unknown>' for missing toolName (never crashes on partial event shapes)", () => {
    const { state } = buildPluginStateForTests();
    handleAfterToolCall(state, { params: {}, result: {} }, { sessionKey: "ses_noname" });
    const entries = state.sessions.getOrCreate("ses_noname").getEntries();
    expect(entries[0].tool).toBe("<unknown>");
  });

  it("hashes inputs as sha256(JSON.stringify(value)) — independently computed (Codex R1 on Epic 4)", () => {
    // Pin the BDD: the helper must be a strict alias for
    // sha256(JSON.stringify(value)). A tautological assertion against
    // sha256Hex itself wouldn't catch the prior string-fast-path bug
    // ("abc" hashed as 3 bytes instead of "\"abc\"" 5 bytes). This
    // test computes the expected hash via node:crypto directly, with
    // no shared code path with the implementation.
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_hash_vector";
    const params = { q: "0G chain", n: 5 };
    const result = "abc";

    handleAfterToolCall(
      state,
      { toolName: "web_search", params, result },
      { sessionKey },
    );
    const entry = state.sessions.getOrCreate(sessionKey).getEntries()[0];

    const expectedInputHash = createHash("sha256")
      .update(JSON.stringify(params), "utf8")
      .digest("hex");
    const expectedOutputHash = createHash("sha256")
      .update(JSON.stringify(result), "utf8") // for "abc" this yields sha256("\"abc\"")
      .digest("hex");
    expect(entry.inputHash).toBe(expectedInputHash);
    expect(entry.outputHash).toBe(expectedOutputHash);
    // Sanity: the BUG-FIX path — string "abc" must NOT hash as 3 bytes.
    const naiveStringHash = createHash("sha256").update("abc", "utf8").digest("hex");
    expect(entry.outputHash).not.toBe(naiveStringHash);
  });

  it("creates a log entry even for unserializable input (BigInt) without crashing (Codex R1 on Epic 4)", () => {
    // BigInt throws on JSON.stringify. Pre-fix, this would crash the
    // handler before any entry was created — leaving a gap in the
    // session log + violating the BDD "error does not crash the
    // session". Post-fix: sha256Hex catches the failure and uses a
    // deterministic <<unserializable:bigint>> fallback. The entry is
    // appended normally; verifiers see SOMETHING for the call.
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_bigint";
    expect(() =>
      handleAfterToolCall(
        state,
        { toolName: "balanceOf", params: { wei: 1234567890123456789n }, result: 999n },
        { sessionKey },
      ),
    ).not.toThrow();
    const entry = state.sessions.getOrCreate(sessionKey).getEntries()[0];
    expect(entry.tool).toBe("balanceOf");
    // Both hashes must be the deterministic fallback for the typed
    // sentinel (object for params, bigint for result), independently
    // computable so the test isn't tautological.
    const expectedInputHash = createHash("sha256")
      .update("<<unserializable:object>>", "utf8")
      .digest("hex");
    const expectedOutputHash = createHash("sha256")
      .update("<<unserializable:bigint>>", "utf8")
      .digest("hex");
    expect(entry.inputHash).toBe(expectedInputHash);
    expect(entry.outputHash).toBe(expectedOutputHash);
  });

  it("creates a log entry even for circular references without crashing", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_circular";
    type Node = { name: string; self?: Node };
    const circular: Node = { name: "loop" };
    circular.self = circular;
    expect(() =>
      handleAfterToolCall(
        state,
        { toolName: "graph_walk", params: circular, result: circular },
        { sessionKey },
      ),
    ).not.toThrow();
    const entry = state.sessions.getOrCreate(sessionKey).getEntries()[0];
    expect(entry.tool).toBe("graph_walk");
    expect(entry.inputHash).toBe(
      createHash("sha256").update("<<unserializable:object>>", "utf8").digest("hex"),
    );
  });
});

// ---------------------------------------------------------------------------
// handleLlmOutput — v0.1.2 broader capture (story-skill-intercept supersession)
// ---------------------------------------------------------------------------

describe("handleLlmOutput — v0.1.2 broader capture", () => {
  it("appends one llm_call entry per llm_output event, with the right shape", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_llm_01";

    handleLlmOutput(
      state,
      {
        runId: "run-abc",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["I'll search the web for that."],
        lastAssistant: "I'll search the web for that.",
        usage: { input: 120, output: 12, total: 132 },
      },
      { sessionKey },
    );

    const logger = state.sessions.getOrCreate(sessionKey);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seq: 0,
      type: "tool_call",
      tool: "llm_call",
    });
    expect(entries[0].inputHash).toBe(
      sha256Hex({
        runId: "run-abc",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        resolvedRef: undefined,
        harnessId: undefined,
      }),
    );
    expect(entries[0].outputHash).toBe(
      sha256Hex({
        assistantTexts: ["I'll search the web for that."],
        lastAssistant: "I'll search the web for that.",
        usage: { input: 120, output: 12, total: 132 },
      }),
    );
  });

  it("3 sequential llm_output events produce 3 entries with monotonic seq (0,1,2)", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_llm_seq";
    for (let i = 0; i < 3; i++) {
      handleLlmOutput(
        state,
        {
          runId: `run-${i}`,
          sessionId: sessionKey,
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          assistantTexts: [`turn ${i} response`],
        },
        { sessionKey },
      );
    }
    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(entries.every((e) => e.tool === "llm_call")).toBe(true);
  });

  it("interleaves correctly with handleAfterToolCall entries (shared SessionLogger)", () => {
    // Real agents emit BOTH OpenClaw-dispatched tool calls AND raw
    // llm_output events. The plugin should record them in arrival
    // order in the same logger.
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_mixed";

    handleAfterToolCall(
      state,
      { toolName: "brave_search", params: { q: "0g" }, result: { hits: 5 } },
      { sessionKey },
    );
    handleLlmOutput(
      state,
      {
        runId: "run-x",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["Got 5 hits. Let me read the first one."],
      },
      { sessionKey },
    );
    handleAfterToolCall(
      state,
      { toolName: "web_fetch", params: { url: "https://0g.ai" }, result: { ok: true } },
      { sessionKey },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.tool)).toEqual([
      "brave_search",
      "llm_call",
      "web_fetch",
    ]);
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("skips entry + warns on missing sessionKey/sessionId (does not throw)", () => {
    const { state } = buildPluginStateForTests();
    expect(() =>
      handleLlmOutput(
        state,
        {
          runId: "run-orphan",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          assistantTexts: ["orphan"],
        },
        {},
      ),
    ).not.toThrow();
    // No session = no logger created.
    expect(state.sessions.has("run-orphan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleAgentEnd — v0.1.2 alternative anchor trigger
// ---------------------------------------------------------------------------

describe("handleAgentEnd — v0.1.2 alternative anchor trigger", () => {
  it("delegates to handleSessionEnd: anchors when buffer has entries", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_agent_end_happy";

    // Seed an entry so there's something to anchor.
    handleLlmOutput(
      state,
      {
        runId: "run-a",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["task complete"],
      },
      { sessionKey },
    );

    await handleAgentEnd(
      state,
      { runId: "run-a", messages: [], success: true, durationMs: 1200 },
      { sessionKey },
    );

    expect(mintSpy).toHaveBeenCalledTimes(1);
    // SessionLogger should be released post-anchor (no double-mint on
    // subsequent session_end for the same key).
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("no-ops when no entries buffered (matches handleSessionEnd behavior)", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    await handleAgentEnd(
      state,
      { runId: "run-empty", messages: [], success: true },
      { sessionKey: "ses_empty" },
    );
    expect(mintSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// v0.3.4 — One Agent Task = One Token (atomic rotate, orphan recovery,
// pendingAnchors retry registry)
// ---------------------------------------------------------------------------

describe("v0.3.4 — one agent_end = one token", () => {
  it("agent_end mints with the `exec-log:` prefix (NOT exec-log-orphan)", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_primary";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "x" }, result: { hits: 1 } },
      { sessionKey },
    );
    await handleAgentEnd(
      state,
      { runId: "run-primary", messages: [], success: true },
      { sessionKey },
    );

    expect(mintSpy).toHaveBeenCalledTimes(1);
    const datas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(datas[0].dataDescription.startsWith("exec-log:")).toBe(true);
    expect(datas[0].dataDescription.startsWith("exec-log-orphan:")).toBe(false);
  });

  it("atomic rotate: after agent_end, a NEW message_received gets a FRESH SessionLogger", async () => {
    // Without atomic-rotate, the second turn's entry would land in
    // the SAME (now-flushed) SessionLogger and silently drop. With
    // takeAndRelease, the new turn starts with a fresh logger and
    // accumulates entries from zero again.
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_rotate";

    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "first" }, result: { hits: 1 } },
      { sessionKey },
    );
    const loggerBeforeRotate = state.sessions.getOrCreate(sessionKey);
    expect(loggerBeforeRotate.getStatus().entryCount).toBeGreaterThan(0);

    await handleAgentEnd(
      state,
      { runId: "run-first", messages: [], success: true },
      { sessionKey },
    );

    // First mint happened
    expect(mintSpy).toHaveBeenCalledTimes(1);
    // sessions map is empty for this sessionKey — confirms takeAndRelease ran
    expect(state.sessions.has(sessionKey)).toBe(false);

    // Second turn — should NOT throw "appendEntry on flushed logger"
    handleAfterToolCall(
      state,
      { toolName: "fetch_url", params: { url: "x" }, result: { ok: true } },
      { sessionKey },
    );
    const loggerAfterRotate = state.sessions.getOrCreate(sessionKey);
    // Fresh logger — different INSTANCE than the rotated one
    expect(loggerAfterRotate).not.toBe(loggerBeforeRotate);
    // seq starts from 0 again (a fresh logger), confirming the second
    // turn isn't reusing the flushed logger's entry counter.
    expect(loggerAfterRotate.getStatus().entryCount).toBe(1);
  });

  // Codex r9 v0.3.4-1 edge case: a SessionLogger can exist with
  // entryCount=0 if an entry handler's getOrCreate succeeded but its
  // append/sign block then threw (and was swallowed by structuredLog).
  // Anchoring an empty log would mint a content-less receipt — feed
  // inflation that the plan explicitly forbids ("bail when no entries").
  it("v0.3.4-1 (Codex r9): skips anchor when SessionLogger exists but has zero entries — primary path", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_zero_entries";
    // Seed an empty logger directly (simulating entry handlers that
    // allocated but threw during append/sign).
    state.sessions.getOrCreate(sessionKey);
    expect(state.sessions.has(sessionKey)).toBe(true);

    await handleAgentEnd(
      state,
      { runId: "run-zero", messages: [], success: true },
      { sessionKey },
    );

    // No mint should fire for an empty logger.
    expect(mintSpy).not.toHaveBeenCalled();
    // And the empty logger should be released so it doesn't linger.
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("v0.3.4-5 (Codex r9): skips orphan recovery when SessionLogger exists but has zero entries — orphan path", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_zero_entries_orphan";
    state.sessions.getOrCreate(sessionKey);

    await handleSessionEnd(state, { trigger: "shutdown" }, { sessionKey });

    expect(mintSpy).not.toHaveBeenCalled();
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("uses event.runId in the success log when provided", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_v034_with_runid";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    await handleAgentEnd(
      state,
      { runId: "run-explicit-123", messages: [], success: true },
      { sessionKey },
    );
    const captured = stderrWrites.join("");
    expect(captured).toContain('"runId":"run-explicit-123"');
    stderrSpy.mockRestore();
  });

  it("falls back to synthetic `anon-<hex>` runId when event.runId is missing", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_v034_no_runid";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    // No runId on the event — exercises the randomBytes(16) fallback.
    await handleAgentEnd(state, { messages: [], success: true }, { sessionKey });
    const captured = stderrWrites.join("");
    expect(captured).toMatch(/"runId":"anon-[0-9a-f]{32}"/);
    stderrSpy.mockRestore();
  });
});

describe("v0.3.4 — session_end orphan recovery", () => {
  it("no-op when no orphan SessionLogger exists (agent_end already anchored)", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_no_orphan";
    // Run a normal agent_end first — clears state.sessions.
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    await handleAgentEnd(
      state,
      { runId: "run-clean", messages: [], success: true },
      { sessionKey },
    );
    expect(mintSpy).toHaveBeenCalledTimes(1);
    // Now session_end fires (channel close). With no orphan logger
    // present, it must NOT mint a second token.
    await handleSessionEnd(state, { trigger: "idle" }, { sessionKey });
    expect(mintSpy).toHaveBeenCalledTimes(1);
  });

  it("mints with `exec-log-orphan:` prefix AND logs ERROR-level orphan notice when an orphan SessionLogger is present", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_orphan_path";
    // Seed an entry, then fire session_end without agent_end first.
    // Simulates a harness crash mid-run.
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "z" }, result: { hits: 1 } },
      { sessionKey },
    );
    await handleSessionEnd(state, { trigger: "shutdown" }, { sessionKey });

    expect(mintSpy).toHaveBeenCalledTimes(1);
    const datas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(datas[0].dataDescription.startsWith("exec-log-orphan:")).toBe(true);

    // v0.3.4-5: the BDD "And" line requires an ERROR-level structured
    // log "Orphan recovery anchor — agent_end never fired" so the
    // operator can spot the abnormal provenance in their gateway log.
    const captured = stderrWrites.join("");
    expect(captured).toMatch(/"level":"ERROR"[^\n]*"component":"session_end"[^\n]*"Orphan recovery anchor — agent_end never fired/);
    stderrSpy.mockRestore();
  });

  it("agent_end + session_end on same sessionKey produces EXACTLY ONE token (no double-mint)", async () => {
    // The atomic rotate is what prevents double-mint. The first
    // handler (whichever runs first) takeAndReleases the logger;
    // the second handler finds null and no-ops cleanly.
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_no_double_mint";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    await Promise.all([
      handleAgentEnd(
        state,
        { runId: "run-x", messages: [], success: true },
        { sessionKey },
      ),
      handleSessionEnd(state, { trigger: "idle" }, { sessionKey }),
    ]);
    expect(mintSpy).toHaveBeenCalledTimes(1);
  });

  // Codex round-4 v0.3.4-5: when turn N's agent_end is still uploading
  // and turn N+1 has already allocated a FRESH SessionLogger under the
  // same sessionKey, session_end MUST orphan-recover the fresh logger
  // (NOT skip it because an older anchor is in-flight).
  it("v0.3.4-5 (Codex r4): orphan-recovers the FRESH logger when a previous agent_end is still in flight", async () => {
    // Slow mint for turn N's agent_end. The orphan-recovery mint
    // (turn N+1, dataDescription startsWith "exec-log-orphan:")
    // resolves immediately so the test doesn't deadlock waiting on
    // both. `reachedOldMintPromise` lets the test deterministically
    // wait until agent_end has finished its async flush and entered
    // the mint stub — no `setTimeout(0)` flakiness.
    let resolveOldMint: ((v: MintResult) => void) | null = null;
    const slowOldMint = new Promise<MintResult>((resolve) => {
      resolveOldMint = resolve;
    });
    let signalReachedOldMint: () => void = () => {};
    const reachedOldMintPromise = new Promise<void>((resolve) => {
      signalReachedOldMint = resolve;
    });
    const mintImpl = async (
      _to: string,
      datas: ReadonlyArray<IntelligentData>,
    ): Promise<MintResult> => {
      const desc = datas[0]?.dataDescription ?? "";
      if (desc.startsWith("exec-log-orphan:")) {
        return { tokenId: 100n, txHash: "0x" + "b".repeat(64) };
      }
      // Turn N's mint — signal then hang on the slow promise.
      signalReachedOldMint();
      return slowOldMint;
    };
    const { state, mintSpy } = buildPluginStateForTests({ mintImpl });
    const sessionKey = "ses_v034_inflight_orphan";

    // Turn N — seed an entry then fire agent_end (don't await).
    handleAfterToolCall(
      state,
      { toolName: "t1", params: {}, result: { hits: 1 } },
      { sessionKey },
    );
    const agentEndPromise = handleAgentEnd(
      state,
      { runId: "run-old", messages: [], success: true },
      { sessionKey },
    );
    // Wait until agent_end's flush+mint has reached the slow mint
    // stub — confirms takeAndRelease and flush both completed and
    // mint is now in flight (stuck on slowOldMint).
    await reachedOldMintPromise;
    expect(state.sessions.has(sessionKey)).toBe(false);
    expect(mintSpy).toHaveBeenCalledTimes(1);

    // Turn N+1 — new after_tool_call allocates a FRESH logger.
    handleAfterToolCall(
      state,
      { toolName: "t2", params: {}, result: { ok: true } },
      { sessionKey },
    );
    expect(state.sessions.has(sessionKey)).toBe(true);

    // session_end fires. With the old (over-broad agentEndInFlight)
    // guard, this would no-op and turn N+1's entries would die in
    // memory. The corrected impl orphan-recovers the fresh logger.
    await handleSessionEnd(state, { trigger: "idle" }, { sessionKey });

    // session_end minted ONE token (turn N+1's orphan). agent_end's
    // mint for turn N is still pending — total mintImpl calls = 2.
    expect(mintSpy).toHaveBeenCalledTimes(2);
    const orphanDatas = mintSpy.mock.calls[1]?.[1] as IntelligentData[];
    expect(orphanDatas[0].dataDescription.startsWith("exec-log-orphan:")).toBe(
      true,
    );

    // Resolve turn N's slow mint so agent_end can complete cleanly.
    resolveOldMint!({ tokenId: 99n, txHash: "0x" + "a".repeat(64) });
    await agentEndPromise;
    // Final tally: 2 mints — one for turn N (exec-log:), one for
    // turn N+1's orphan (exec-log-orphan:). Confirms turn N's anchor
    // used the normal prefix.
    expect(mintSpy).toHaveBeenCalledTimes(2);
    const oldDatas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(oldDatas[0].dataDescription.startsWith("exec-log:")).toBe(true);
    expect(oldDatas[0].dataDescription.startsWith("exec-log-orphan:")).toBe(
      false,
    );
  });

  // Codex round-2 v0.3.4-6: handleSessionEnd's microtask yield must
  // make agent_end win the race in BOTH orderings, so a normal run
  // never gets mislabeled as `exec-log-orphan:`.
  it("v0.3.4-6 (Codex r2): reverse-order race — session_end scheduled FIRST still produces exec-log: (NOT exec-log-orphan:)", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_v034_reverse_race";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    // session_end FIRST in the Promise.all argument order — without
    // the agentEndInFlight + Promise.resolve() coordination this
    // would race past agent_end's prelude and mint `exec-log-orphan:`.
    await Promise.all([
      handleSessionEnd(state, { trigger: "idle" }, { sessionKey }),
      handleAgentEnd(
        state,
        { runId: "run-reverse", messages: [], success: true },
        { sessionKey },
      ),
    ]);
    expect(mintSpy).toHaveBeenCalledTimes(1);
    const datas = mintSpy.mock.calls[0]?.[1] as IntelligentData[];
    expect(datas[0].dataDescription.startsWith("exec-log:")).toBe(true);
    expect(datas[0].dataDescription.startsWith("exec-log-orphan:")).toBe(false);
  });
});

describe("v0.3.4 — pendingAnchors retry registry", () => {
  it("logger lands in pendingAnchors when flush fails BEFORE mint — same instance, entries intact", async () => {
    // Simulate a flush failure via uploadOverride that throws.
    const { state, mintSpy } = buildPluginStateForTests({
      uploadOverride: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as IndexerLike["upload"],
    });
    const sessionKey = "ses_v034_preflush_fail";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: { q: "x" }, result: { hits: 7 } },
      { sessionKey },
    );
    // Capture the SessionLogger reference BEFORE handleAgentEnd so the
    // post-failure assertion can verify identity (the stored value is
    // the actual logger, not just a placeholder). This pins the
    // "registered logger has not been GC'd" BDD invariant — Codex r7
    // caught that the map-key-only check didn't prove that.
    const loggerBeforeAnchor = state.sessions.getOrCreate(sessionKey);
    expect(loggerBeforeAnchor.getStatus().entryCount).toBe(1);

    await handleAgentEnd(
      state,
      { runId: "run-preflush", messages: [], success: true },
      { sessionKey },
    );

    expect(mintSpy).not.toHaveBeenCalled();
    // The plaintext logger is the ONLY copy of those entries — must
    // stay registered AND BE the same instance for manual recovery.
    expect(state.pendingAnchors.size).toBe(1);
    const pendingKey = `${sessionKey}|run:run-preflush`;
    expect([...state.pendingAnchors.keys()]).toEqual([pendingKey]);
    const retainedLogger = state.pendingAnchors.get(pendingKey);
    // Identity: the registered VALUE is the exact unflushed logger
    // instance we rotated out — not a fresh placeholder or null.
    expect(retainedLogger).toBe(loggerBeforeAnchor);
    // Usability: the retained logger still holds the entries that
    // accumulated before the failed flush, so a manual recovery
    // (`logger.flush({encrypt})` from the structured-log hint) can
    // anchor them.
    expect(retainedLogger?.getStatus().entryCount).toBe(1);
    expect(retainedLogger?.getStatus().flushed).toBe(false);
  });

  it("registry is CLEARED on successful mint (bytes durable; plaintext not needed)", async () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_v034_clear_on_success";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    await handleAgentEnd(
      state,
      { runId: "run-cleared", messages: [], success: true },
      { sessionKey },
    );
    // Registry must be empty — keeping the plaintext logger past
    // mint is a memory + privacy regression (round-4 narrowing).
    expect(state.pendingAnchors.size).toBe(0);
  });

  it("registry is CLEARED on SessionAnchorMintAfterFlushError AND structured-log carries dataDescriptionPrefix (bytes durable)", async () => {
    // Mint fails after flush — but flush succeeded, so the encrypted
    // bytes are on 0G Storage. The plaintext logger is no longer the
    // only copy: rootHash + entryCount + sessionId +
    // dataDescriptionPrefix on the error give recovery everything it
    // needs. Clear the registry.
    //
    // v0.3.4-9 BDD "And" line: structured-log MUST include
    // `dataDescriptionPrefix` so an operator's retryMint() call can
    // preserve it (orphan-recovery anchors would otherwise silently
    // re-label as exec-log: on retry).
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderrWrites.push(String(chunk));
        return true;
      });
    const { state } = buildPluginStateForTests({
      mintImpl: async () => {
        throw new Error("transient RPC failure");
      },
    });
    const sessionKey = "ses_v034_postflush_fail";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    await handleAgentEnd(
      state,
      { runId: "run-postflush", messages: [], success: true },
      { sessionKey },
    );
    expect(state.pendingAnchors.size).toBe(0);

    const captured = stderrWrites.join("");
    // The post-flush failure log line must explicitly carry the prefix.
    expect(captured).toContain('"dataDescriptionPrefix":"exec-log"');
    // Recovery hint embeds it too so a copy-paste retryMint() call
    // preserves the prefix on the chain.
    expect(captured).toContain('dataDescriptionPrefix:\\"exec-log\\"');
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleSessionEnd — story-skill-close
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v0.2.0 — per-entry ECDSA signing (agent-wrapper convention)
// ---------------------------------------------------------------------------

describe("v0.2.0 entry signing — agent-wrapper convention", () => {
  it("signs every after_tool_call entry; signature recovers to config.agentId", () => {
    // Match signer.address to config.agentId — that's the dashboard's
    // verification model: ecrecover(digest, sig) === entry.agentId,
    // no separate global oracle required.
    const pk = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const signerForTest = new Wallet(pk);
    const { state } = buildPluginStateForTests({
      configOverrides: { agentId: signerForTest.address },
      signerPrivateKey: pk,
    });
    const sessionKey = "ses_sign_01";

    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "0g news" }, result: { hits: 3 } },
      { sessionKey },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    // The five TEE fields are NOW populated per ADR-07/13 (v0.2.0).
    expect(entry.agentId).toBe(signerForTest.address);
    expect(entry.sealId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof entry.signedAt).toBe("number");
    expect(entry.teeSignature).toMatch(/^0x[0-9a-f]{130}$/);

    // ecrecover the signature → must equal entry.agentId.
    const message = `${entry.agentId}|${entry.sealId}|${entry.signedAt}|${entry.outputHash}`;
    const digest = keccak256(toUtf8Bytes(message));
    const recovered = recoverAddress(digest, entry.teeSignature!);
    expect(recovered.toLowerCase()).toBe(signerForTest.address.toLowerCase());
  });

  it("each entry in a multi-tool-call session has a UNIQUE sealId (sessionKey,seq derivation)", () => {
    const pk = "0x0000000000000000000000000000000000000000000000000000000000000002";
    const signerForTest = new Wallet(pk);
    const { state } = buildPluginStateForTests({
      configOverrides: { agentId: signerForTest.address },
      signerPrivateKey: pk,
    });
    const sessionKey = "ses_sign_seq";

    for (let i = 0; i < 3; i++) {
      handleAfterToolCall(
        state,
        { toolName: `tool_${i}`, params: { i }, result: { ok: true, i } },
        { sessionKey },
      );
    }

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(3);
    const sealIds = entries.map((e) => e.sealId);
    expect(new Set(sealIds).size).toBe(3); // all distinct

    // Every signature still recovers to agentId.
    for (const e of entries) {
      const message = `${e.agentId}|${e.sealId}|${e.signedAt}|${e.outputHash}`;
      const digest = keccak256(toUtf8Bytes(message));
      const recovered = recoverAddress(digest, e.teeSignature!);
      expect(recovered.toLowerCase()).toBe(signerForTest.address.toLowerCase());
    }
  });

  it("signs llm_output entries with the same convention", () => {
    const pk = "0x0000000000000000000000000000000000000000000000000000000000000003";
    const signerForTest = new Wallet(pk);
    const { state } = buildPluginStateForTests({
      configOverrides: { agentId: signerForTest.address },
      signerPrivateKey: pk,
    });
    const sessionKey = "ses_sign_llm";

    handleLlmOutput(
      state,
      {
        runId: "run-sign",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["signed response"],
        lastAssistant: "signed response",
      },
      { sessionKey },
    );

    const entry = state.sessions.getOrCreate(sessionKey).getEntries()[0];
    expect(entry.agentId).toBe(signerForTest.address);
    expect(entry.teeSignature).toMatch(/^0x[0-9a-f]{130}$/);
    const message = `${entry.agentId}|${entry.sealId}|${entry.signedAt}|${entry.outputHash}`;
    const digest = keccak256(toUtf8Bytes(message));
    expect(recoverAddress(digest, entry.teeSignature!).toLowerCase()).toBe(
      signerForTest.address.toLowerCase(),
    );
  });
});

// ---------------------------------------------------------------------------
// v0.2.0 — parseAssistantBlocks + new event handlers
// ---------------------------------------------------------------------------

describe("v0.2.0 parseAssistantBlocks", () => {
  it("returns [] for non-object / array-less inputs", () => {
    expect(parseAssistantBlocks(null)).toEqual([]);
    expect(parseAssistantBlocks(undefined)).toEqual([]);
    expect(parseAssistantBlocks("text")).toEqual([]);
    expect(parseAssistantBlocks({ content: "not an array" })).toEqual([]);
  });

  it("parses Anthropic-style text + thinking + tool_use blocks", () => {
    const blocks = parseAssistantBlocks({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me search the web" },
        { type: "tool_use", name: "web_search", input: { q: "0g news" }, id: "t1" },
        { type: "text", text: "Here are the results…" },
      ],
    });
    expect(blocks).toEqual([
      { kind: "reasoning", thinking: "let me search the web" },
      {
        kind: "tool_use",
        name: "web_search",
        arguments: { q: "0g news" },
        toolCallId: "t1",
      },
      { kind: "llm_text", text: "Here are the results…" },
    ]);
  });

  it("parses OpenClaw-normalized `toolCall` blocks (alias for tool_use)", () => {
    const blocks = parseAssistantBlocks({
      content: [
        {
          type: "toolCall",
          toolCallId: "t2",
          name: "memory_lookup",
          arguments: { key: "user_pref" },
        },
      ],
    });
    expect(blocks).toEqual([
      {
        kind: "tool_use",
        name: "memory_lookup",
        arguments: { key: "user_pref" },
        toolCallId: "t2",
      },
    ]);
  });

  it("skips unrecognized block types", () => {
    const blocks = parseAssistantBlocks({
      content: [
        { type: "text", text: "kept" },
        { type: "unknown_block", payload: "dropped" },
        { type: "thinking", thinking: "kept" },
      ],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("llm_text");
    expect(blocks[1].kind).toBe("reasoning");
  });
});

describe("v0.2.0 handleLlmOutput — multi-block emit", () => {
  it("emits one entry per parsed block (thinking + tool_use + text → 3 entries)", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_blocks_01";

    handleLlmOutput(
      state,
      {
        runId: "run-blocks",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["unused-when-blocks-parse"],
        lastAssistant: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I should search the web" },
            { type: "tool_use", name: "web_search", input: { q: "0g news" } },
            { type: "text", text: "Found 3 articles." },
          ],
        },
      },
      { sessionKey },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.tool)).toEqual([
      "reasoning",
      "tool_use",
      "llm_text",
    ]);
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    // Each entry still signed.
    for (const e of entries) {
      expect(e.teeSignature).toMatch(/^0x[0-9a-f]{130}$/);
      expect(e.sealId).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("falls back to single llm_call entry when lastAssistant has no parseable blocks", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_blocks_fallback";

    handleLlmOutput(
      state,
      {
        runId: "run-fallback",
        sessionId: sessionKey,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        assistantTexts: ["just-a-string"],
        lastAssistant: "just-a-string", // no .content array
      },
      { sessionKey },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe("llm_call");
  });
});

describe("v0.2.0 handleMessageReceived", () => {
  it("appends a user_input entry with senderId in params and content in result", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_msg_01";

    handleMessageReceived(
      state,
      { content: "search the web for 0g news", senderId: "user_abc" },
      { sessionKey, channelId: "telegram:direct:123" },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe("user_input");
    expect(entries[0].teeSignature).toMatch(/^0x[0-9a-f]{130}$/);
    expect((entries[0].result as { content: string }).content).toBe(
      "search the web for 0g news",
    );
  });

  it("skips when no sessionKey/sessionId in ctx (does not throw)", () => {
    const { state } = buildPluginStateForTests();
    expect(() =>
      handleMessageReceived(state, { content: "orphan" }, {}),
    ).not.toThrow();
    expect(state.sessions.has("orphan")).toBe(false);
  });
});

describe("v0.3.3 handleBeforePromptBuild (full content capture)", () => {
  // v0.2.0 stripped body content for privacy. v0.3.3 captures the
  // FULL prompt + systemPrompt + history because v0.3.0 encryption
  // protects the content at rest (only the operator's /share emits
  // the key). Abu's 2026-05-13 feedback on token 65: "we only saw
  // CLI calls. Okay, we saw the prompt build. The output just says
  // prompt length, everything. Who wants to care about this?"
  it("appends a prompt_build entry with FULL prompt + system prompt + history", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_pb_01";
    const prompt = "What's the ETH price and the latest 0G Labs news?";
    const systemPrompt = "You are a research agent. Use web_search.";
    const history = [
      { role: "user", content: "earlier msg" },
      { role: "assistant", content: "earlier reply" },
    ];

    handleBeforePromptBuild(
      state,
      { prompt, systemPrompt, historyMessages: history },
      { sessionKey, modelProviderId: "anthropic", modelId: "claude-sonnet-4-6" },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe("prompt_build");
    expect(entries[0].teeSignature).toMatch(/^0x[0-9a-f]{130}$/);
    const result = entries[0].result as Record<string, unknown>;
    // Metadata fields (preserved for backward compat / quick scan)
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.historyMessagesLength).toBe(2);
    expect(result.promptLength).toBe(prompt.length);
    expect(result.systemPromptLength).toBe(systemPrompt.length);
    // FULL content — the audit signal Abu wanted.
    expect(result.prompt).toBe(prompt);
    expect(result.systemPrompt).toBe(systemPrompt);
    expect(result.historyMessages).toEqual(history);
  });
});

// ---------------------------------------------------------------------------
// v0.3.0 — handleSessionEnd encrypts the SessionLog + manages keystore
// ---------------------------------------------------------------------------

describe("v0.3.0 handleSessionEnd — encrypted flush + keystore", () => {
  it("uploads an encrypted envelope (not plaintext SessionLog) and stores K in keystore by tokenId", async () => {
    // The upload spy CAPTURES whatever bytes the SessionLogger passed
    // to the storage client. After v0.3.0 those bytes are the JSON of
    // an EncryptedSessionLogEnvelope, NOT a plaintext SessionLog.
    let capturedBytes: Uint8Array | null = null;
    const uploadOverride = async (memData: { data: ArrayLike<number> }) => {
      // MemData wraps `data: ArrayLike<number>` — straight access; no
      // async `read()`. Clone into a Uint8Array so the assertion runs
      // on a stable snapshot.
      capturedBytes = new Uint8Array(Array.from(memData.data));
      return [
        { rootHash: ROOT_HASH, txHash: "0x" + "a".repeat(64), txSeq: 0 },
        null,
      ] as const;
    };
    const { state } = buildPluginStateForTests({
      uploadOverride: uploadOverride as unknown as IndexerLike["upload"],
    });
    const sessionKey = "ses_v030_encrypt_01";
    // Seed an entry so the flush has content.
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "0g" }, result: { hits: 3 } },
      { sessionKey },
    );

    await handleSessionEnd(
      state,
      { messages: [], success: true },
      { sessionKey },
    );

    // 1) Uploaded bytes are the encrypted envelope shape, not plaintext.
    expect(capturedBytes).not.toBeNull();
    const uploadedJson = new TextDecoder().decode(capturedBytes!);
    const uploaded = JSON.parse(uploadedJson) as Record<string, unknown>;
    expect(uploaded.v).toBe(1);
    expect(uploaded.alg).toBe("aes-256-gcm");
    expect(typeof uploaded.iv).toBe("string");
    expect(typeof uploaded.ciphertext).toBe("string");
    expect(typeof uploaded.tag).toBe("string");
    // Plaintext-SessionLog field names MUST NOT appear in the upload.
    expect(uploadedJson).not.toContain("sessionId");
    expect(uploadedJson).not.toContain("entries");

    // 2) Keystore contains a 32-byte key indexed by tokenId.
    const tokenId = "99"; // stub mint result in buildAgenticIdClient
    const k = state.keystore.get(tokenId);
    expect(k).not.toBeNull();
    expect(k!.length).toBe(32);

    // 3) Last-receipt pointer points to this tokenId.
    const last = state.keystore.getLast();
    expect(last?.tokenId).toBe(tokenId);
    expect(last?.sessionKey).toBe(sessionKey);
  });

  // Codex rounds 9 + 16 (CRITICAL SECURITY/PRIVACY): the routine
  // success log on session_end MUST NOT include:
  //   - the reveal key / shareUrl / #k= fragment (round-9 cryptographic)
  //   - the sessionKey itself (round-16 privacy: it encodes channel
  //     routing — e.g. "agent:core:telegram:direct:<userId>" leaks
  //     the Telegram user ID on every anchor)
  // sessionKey is retained ONLY in error/recovery log lines (where the
  // operator needs it for retryMint/commitPending) and in /share replies.
  it("success log is privacy-minimal: no reveal key, no shareUrl, no sessionKey", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        if (typeof chunk === "string") stderrWrites.push(chunk);
        else if (chunk instanceof Buffer) stderrWrites.push(chunk.toString("utf8"));
        return true;
      });
    const { state } = buildPluginStateForTests();
    // Use a realistic OpenClaw sessionKey that ENCODES user routing
    // info — exactly the metadata we don't want in logs.
    const sessionKey = "agent:core:telegram:direct:8028166336";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "x" }, result: { hits: 1 } },
      { sessionKey },
    );
    await handleSessionEnd(state, { messages: [], success: true }, { sessionKey });

    const captured = stderrWrites.join("");
    // Round-9 cryptographic invariants:
    expect(captured).not.toContain("#k=");
    expect(captured).not.toMatch(/shareUrl/);
    // Round-16 privacy invariants: the success log line must NOT
    // contain the sessionKey or the Telegram user ID it encodes.
    // Filter to the "Session anchored on-chain" line specifically —
    // error/recovery branches DO log sessionKey by design.
    const successLines = captured
      .split("\n")
      .filter((line) => line.includes("Session anchored on-chain"));
    expect(successLines.length).toBeGreaterThanOrEqual(1);
    for (const line of successLines) {
      expect(line).not.toContain(sessionKey);
      expect(line).not.toContain("8028166336");
      expect(line).not.toContain("telegram");
    }
    // Positive: the allowed BDD-spec fields ARE in the line.
    for (const line of successLines) {
      expect(line).toMatch(/tokenId/);
      expect(line).toMatch(/txHash/);
      expect(line).toMatch(/rootHash/);
      expect(line).toMatch(/entryCount/);
      expect(line).toMatch(/verifyUrl/);
    }
    stderrSpy.mockRestore();
  });

  it("survives a crash between setPending and mint — pending key recoverable by sessionKey", async () => {
    // Force mint to fail. The keystore should retain pending/<sessionKey>.key
    // so the operator can recover (manual commitPending after retryMint).
    const { state } = buildPluginStateForTests({
      mintImpl: async () => {
        throw new Error("simulated network failure during iMint");
      },
    });
    const sessionKey = "ses_v030_crash_01";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "0g" }, result: { hits: 3 } },
      { sessionKey },
    );

    await handleSessionEnd(
      state,
      { messages: [], success: true },
      { sessionKey },
    );

    // tokenId 99 was never created (mint failed), so no committed key.
    expect(state.keystore.get("99")).toBeNull();
    expect(state.keystore.list().length).toBe(0);
    // BUT the pending key + sidecar MUST be recoverable so the operator
    // can finish the commit after retryMint. Codex round-3 strengthened
    // this: assert the actual pending entry surfaces with the original
    // sessionKey via listPending() (not just "committed list is empty").
    const pending = state.keystore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sessionKey).toBe(sessionKey);
    // Operator can later: retryMint → get tokenId → commitPending(sessionKey, tokenId).
  });

  // Codex round-12 P1: post-mint commitPending failure must be
  // handled as its own branch, NOT mislabeled as "pre-flush" via the
  // outer catch. Operator needs the tokenId + a specific recovery
  // hint pointing at manual commitPending.
  it("logs a tokenId-specific recovery hint when commitPending throws AFTER successful mint", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        if (typeof chunk === "string") stderrWrites.push(chunk);
        else if (chunk instanceof Buffer) stderrWrites.push(chunk.toString("utf8"));
        return true;
      });
    const { state } = buildPluginStateForTests();
    // Stub commitPending AND put to simulate "FS unwritable after mint."
    const commitSpy = vi
      .spyOn(state.keystore, "commitPending")
      .mockImplementation(() => {
        throw new Error("EROFS: read-only file system");
      });
    const sessionKey = "ses_commit_fails";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "x" }, result: { hits: 1 } },
      { sessionKey },
    );
    // v0.3.4: handleAgentEnd is the primary anchor; handleSessionEnd
    // is orphan recovery. This test exercises the post-mint commit
    // failure on the primary path.
    await handleAgentEnd(
      state,
      { runId: "run-commit-fail", messages: [], success: true },
      { sessionKey },
    );

    const captured = stderrWrites.join("");
    // Specific post-mint message, NOT the generic "pre-flush" label.
    expect(captured).toMatch(/Keystore commit failed AFTER successful mint/);
    expect(captured).not.toMatch(/Flush failed before mint/);
    // tokenId 99 (the stub mint result) MUST appear in the recovery
    // hint so the operator knows the receipt is anchored and can
    // call keystore.commitPending(...) manually.
    expect(captured).toContain('tokenId 99');
    // v0.3.4: the recovery hint embeds the COMPOUND pendingKeyName
    // (`${sessionKey}|run:${runId}`) and the bare sessionKey + runId
    // meta bag. Logs are JSON-stringified so quotes appear escaped.
    expect(captured).toContain(
      'commitPending(\\"ses_commit_fails|run:run-commit-fail\\", \\"99\\", {sessionKey:\\"ses_commit_fails\\", runId:\\"run-commit-fail\\"})',
    );
    // Reveal-key invariants from round-9 still hold:
    expect(captured).not.toContain("#k=");
    commitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  // Hard-fail invariant (Codex round-3): if keystore.setPending throws
  // (FS unwritable / disk full), the anchor MUST abort before upload.
  // Silently degrading to plaintext upload would violate the v0.3.0
  // encrypted-by-default contract.
  //
  // v0.3.4 strengthens this: the SessionLogger STAYS in state.sessions
  // (NOT moved to pendingAnchors) so the next agent_end auto-retries
  // on the same sessionKey without operator intervention.
  it("aborts before upload when keystore.setPending fails — no plaintext leak; logger retained in state.sessions for auto-retry", async () => {
    let uploadCalls = 0;
    const uploadOverride = async () => {
      uploadCalls++;
      return [
        { rootHash: ROOT_HASH, txHash: "0x" + "a".repeat(64), txSeq: 0 },
        null,
      ] as const;
    };
    const { state, mintSpy } = buildPluginStateForTests({
      uploadOverride: uploadOverride as unknown as IndexerLike["upload"],
    });
    // Stub keystore.setPending to simulate "FS unwritable" condition.
    const setPendingSpy = vi
      .spyOn(state.keystore, "setPending")
      .mockImplementation(() => {
        throw new Error("EROFS: read-only file system");
      });
    const sessionKey = "ses_setpending_fails";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "x" }, result: { hits: 1 } },
      { sessionKey },
    );
    // Exercise via handleAgentEnd (the primary anchor in v0.3.4).
    await handleAgentEnd(
      state,
      { runId: "run-setpending-fail", messages: [], success: true },
      { sessionKey },
    );

    expect(setPendingSpy).toHaveBeenCalledOnce();
    // CRITICAL: no upload, no mint. The session log remains in-memory.
    expect(uploadCalls).toBe(0);
    expect(mintSpy).not.toHaveBeenCalled();
    // No committed key either — nothing was minted.
    expect(state.keystore.list()).toEqual([]);
    // v0.3.4 retry semantic: logger STAYS in state.sessions so the
    // NEXT agent_end on this sessionKey re-attempts with a fresh K.
    expect(state.sessions.has(sessionKey)).toBe(true);
    // And it MUST NOT be parked in pendingAnchors (that registry is
    // for un-flushed loggers POST-rotate; pre-rotate failures never
    // touch it).
    expect(state.pendingAnchors.size).toBe(0);
    setPendingSpy.mockRestore();
  });
});

describe("handleSessionEnd — story-skill-close", () => {
  it("flushes + mints + releases on success, with full verifyUrl built from config.verifyUrlBase", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    const sessionKey = "ses_close_happy";

    // Seed one tool call so there's something to flush.
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );
    expect(state.sessions.has(sessionKey)).toBe(true);

    // v0.3.4: the primary anchor responsibility moved from
    // handleSessionEnd to handleAgentEnd ("one agent task = one
    // token"). handleSessionEnd is now the orphan-recovery branch
    // — see the dedicated orphan-recovery tests below for that
    // path's BDD.
    await handleAgentEnd(
      state,
      { runId: "run-happy", messages: [], success: true },
      { sessionKey },
    );

    // mint was called exactly once with the expected payload shape
    expect(mintSpy).toHaveBeenCalledTimes(1);
    const [recipient, datas] = mintSpy.mock.calls[0] as [
      string,
      IntelligentData[],
      number | undefined,
    ];
    expect(recipient).toBe(state.config.agentId);
    expect(datas).toHaveLength(1);
    expect(datas[0].dataDescription).toBe(
      `exec-log:${sessionKey}:${state.config.modelId}`,
    );
    expect(datas[0].dataHash).toBe(ROOT_HASH);

    // SessionLogger was rotated out on success — no dangling state.
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("does not anchor when no SessionLogger exists for the sessionKey (BDD: zero tool calls)", async () => {
    const { state, mintSpy } = buildPluginStateForTests();
    await handleSessionEnd(state, {}, { sessionKey: "ses_unused" });
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("releases SessionLogger even when mint throws (BDD: no dangling logger after failure)", async () => {
    const { state, mintSpy } = buildPluginStateForTests({
      mintImpl: async () => {
        throw new Error("transient RPC failure");
      },
    });
    const sessionKey = "ses_close_mintfail";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );

    // Should NOT throw — error is caught and surfaced as structured log.
    await expect(handleSessionEnd(state, {}, { sessionKey })).resolves.toBeUndefined();
    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("captures rootHash from SessionAnchorMintAfterFlushError so operators can retryMint manually", async () => {
    const { state } = buildPluginStateForTests({
      mintImpl: async () => {
        throw new Error("network unreachable");
      },
    });
    const sessionKey = "ses_close_recovery";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );

    // Drive session_end and capture stderr so we can assert the
    // rootHash is included in the structured failure log.
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await handleSessionEnd(state, {}, { sessionKey });
    } finally {
      process.stderr.write = originalWrite;
    }

    const errorLogs = stderrChunks.filter((c) => c.includes('"level":"ERROR"'));
    expect(errorLogs.length).toBeGreaterThan(0);
    const errorPayload = errorLogs.join("");
    // The structured failure must include rootHash (recovery context)
    // AND the explicit recovery instruction so operators can act on it.
    expect(errorPayload).toContain('"rootHash"');
    expect(errorPayload).toContain(ROOT_HASH);
    expect(errorPayload).toContain("retryMint");
    expect(state.sessions.has(sessionKey)).toBe(false);
  });

  it("does not throw on missing sessionKey (BDD: never crash the session)", async () => {
    const { state } = buildPluginStateForTests();
    await expect(handleSessionEnd(state, {}, {})).resolves.toBeUndefined();
  });

  it("verifyUrl in success log includes config.verifyUrlBase + relative /verify/<tokenId> (network is implicit from domain)", async () => {
    const { state } = buildPluginStateForTests({
      configOverrides: { verifyUrlBase: "https://verify.example.com/" }, // trailing slash on purpose
    });
    const sessionKey = "ses_close_url";
    handleAfterToolCall(
      state,
      { toolName: "noop", params: {}, result: {} },
      { sessionKey },
    );

    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    try {
      await handleSessionEnd(state, {}, { sessionKey });
    } finally {
      process.stderr.write = originalWrite;
    }
    const successLogs = stderrChunks.filter((c) => c.includes("Session anchored on-chain"));
    expect(successLogs.length).toBeGreaterThan(0);
    // Trailing slash on verifyUrlBase must be stripped before
    // concatenating the relative /verify/ path so we don't get
    // "...com//verify/...".
    expect(successLogs.join("")).toContain(
      `https://verify.example.com/verify/${MINT_TOKEN_ID.toString()}`,
    );
    // Defensive: chainId must NOT appear in the path. Network is
    // disambiguated by the verifyUrlBase domain (subdomain split),
    // not by a chainId segment.
    expect(successLogs.join("")).not.toContain(
      `/${state.config.chainId}/`,
    );
  });
});
