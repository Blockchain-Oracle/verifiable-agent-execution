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

  // Codex round-11 reconciled (replacing round-8 paranoia): the stock
  // OpenClaw codex plugin
  // (/tmp/openclaw-src/extensions/codex/src/conversation-binding.ts:143)
  // demonstrates that OpenClaw 2026.4.x routes inbound_claim PER
  // registered command — a plugin's handler only fires for ITS own
  // command name. So a Discord-style "args-only" /share event is
  // (a) valid and (b) safely distinct from /upload or /summarize.
  // Trust the runtime; only check commandAuthorized.
  it("accepts an authorized structured (args-only) /share event — channel pre-split args", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);
    const handler = getInboundClaimHandler(onSpy);
    const result = handler({
      commandAuthorized: true,
      args: ["42"],
    });
    // handleShareCommand reads args[0] as the tokenId. The keystore is
    // empty in this fresh test, so the friendly "no key on host"
    // reply fires — the gate let the handler through, which is what
    // we're pinning.
    expect(result?.handled).toBe(true);
    expect(result?.reply?.text).toMatch(/No key on this host/i);
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
  return {
    state: { config, sessions, agenticIdClient, signer, keystore },
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

describe("v0.2.0 handleBeforePromptBuild", () => {
  it("appends a prompt_build entry with model/provider metadata only (no body)", () => {
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_pb_01";

    handleBeforePromptBuild(
      state,
      {
        prompt: "this is the actual prompt body — should NOT appear in entry",
        systemPrompt: "long system prompt 50KB+",
        historyMessages: [{ role: "user" }, { role: "assistant" }],
      },
      { sessionKey, modelProviderId: "anthropic", modelId: "claude-sonnet-4-6" },
    );

    const entries = state.sessions.getOrCreate(sessionKey).getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe("prompt_build");
    expect(entries[0].teeSignature).toMatch(/^0x[0-9a-f]{130}$/);
    const result = entries[0].result as Record<string, unknown>;
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.historyMessagesLength).toBe(2);
    // Body content NOT stored — only lengths.
    expect(JSON.stringify(result)).not.toContain("this is the actual prompt");
    expect(JSON.stringify(result)).not.toContain("long system prompt 50KB");
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

  // Codex round-9 P1 (CRITICAL SECURITY): the reveal key must NEVER
  // appear in log streams. Earlier revisions auto-logged the full
  // shareUrl (with `#k=<key>` fragment) on every session_end, leaking
  // decryption material to gateway logs / log collectors / observability
  // stacks. The whole encrypted-by-default contract collapses if the
  // key trivially leaves the process. Pin: structuredLog output for a
  // successful session_end MUST NOT contain "#k=" or the literal key.
  it("does NOT log the reveal key on session_end (no #k= leak into stderr)", async () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        if (typeof chunk === "string") stderrWrites.push(chunk);
        else if (chunk instanceof Buffer) stderrWrites.push(chunk.toString("utf8"));
        return true;
      });
    const { state } = buildPluginStateForTests();
    const sessionKey = "ses_log_no_key_leak";
    handleAfterToolCall(
      state,
      { toolName: "web_search", params: { q: "x" }, result: { hits: 1 } },
      { sessionKey },
    );
    await handleSessionEnd(state, { messages: [], success: true }, { sessionKey });

    const captured = stderrWrites.join("");
    // The decryption key never appears in stderr — fragment marker
    // and the b64url alphabet of the key itself.
    expect(captured).not.toContain("#k=");
    expect(captured).not.toMatch(/shareUrl/);
    // Confirm a successful session_end DID happen (key-free log line
    // is present); we're asserting the leak is absent, not that no log
    // was emitted.
    expect(captured).toMatch(/Session anchored on-chain/);
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

  // Hard-fail invariant (Codex round-3): if keystore.setPending throws
  // (FS unwritable / disk full), handleSessionEnd MUST abort before
  // upload. Silently degrading to plaintext upload would violate the
  // v0.3.0 encrypted-by-default contract.
  it("aborts before upload when keystore.setPending fails — no plaintext leak", async () => {
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
    await handleSessionEnd(state, { messages: [], success: true }, { sessionKey });

    expect(setPendingSpy).toHaveBeenCalledOnce();
    // CRITICAL: no upload, no mint. The session log remains in-memory
    // for the operator to retry once the FS is fixed.
    expect(uploadCalls).toBe(0);
    expect(mintSpy).not.toHaveBeenCalled();
    // No committed key either — nothing was minted.
    expect(state.keystore.list()).toEqual([]);
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

    await handleSessionEnd(state, {}, { sessionKey });

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

    // SessionLogger was released after success — no dangling state.
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
