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

import { Wallet } from "ethers";
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
  handleSessionEnd,
} from "../src/index.js";
import { resolveConfig, type VerifiableExecutionConfig } from "../src/config.js";
import { sha256Hex } from "../src/hash.js";
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
  it("registers after_tool_call and session_end hooks via api.registerHook", () => {
    const { api, onSpy } = makeFakeApi(FULL_CONFIG);
    plugin.register(api);

    // Two hooks should be registered — after_tool_call + session_end.
    expect(onSpy).toHaveBeenCalledTimes(2);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toContain("after_tool_call");
    expect(events).toContain("session_end");
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

  it("still registers no-op hooks in degraded mode (so OpenClaw sees the plugin as healthy)", () => {
    const { api, onSpy } = makeFakeApi({});
    plugin.register(api);
    // Same number of hooks registered, same event names — only the
    // handler bodies differ (no-op vs real). This keeps the plugin
    // surface consistent so an operator can fix config + restart
    // without re-reading the registration log.
    expect(onSpy).toHaveBeenCalledTimes(2);
    const events = onSpy.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["after_tool_call", "session_end"]),
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
  it("returns ok=true with all defaults when full config is supplied", () => {
    const result = resolveConfig(FULL_CONFIG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.privateKeyEnvVar).toBe("PRIVATE_KEY");
      expect(result.config.chainId).toBe(16602);
      expect(result.config.agentId).toBe(VALID_AGENT_ADDRESS);
    }
  });

  it("reports ALL missing required fields in one go (not just the first)", () => {
    const result = resolveConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 7 required string/number fields (privateKeyEnvVar has a default
      // and is therefore not in `missing`).
      expect(result.missing.length).toBeGreaterThanOrEqual(7);
      expect(result.missing).toEqual(
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

  it("flags malformed addresses as 'invalid' (separate bucket from 'missing')", () => {
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

  it("rejects a non-integer / zero / negative chainId", () => {
    for (const bad of [0, -1, 1.5, "16602", null]) {
      const result = resolveConfig({ ...FULL_CONFIG, chainId: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.missing).toContain("chainId");
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
}) {
  const config = buildResolvedConfig(opts?.configOverrides);
  const storageClient = buildStorageClient({ uploadOverride: opts?.uploadOverride });
  const sessions = new SessionManager({ storageClient });
  const { client: agenticIdClient, mintSpy } = buildAgenticIdClient({
    mintImpl: opts?.mintImpl,
  });
  return { state: { config, sessions, agenticIdClient }, mintSpy };
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
// handleSessionEnd — story-skill-close
// ---------------------------------------------------------------------------

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
