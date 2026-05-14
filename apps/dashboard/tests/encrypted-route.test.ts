/**
 * Tests for v0.3.0 encrypted-receipt routes — Codex round-1 must-fix.
 *
 * Two routes under test:
 *   - GET /api/verify/[tokenId]            → metadata-only when encrypted
 *   - GET /api/verify/[tokenId]/blob       → raw envelope passthrough
 *
 * Both routes are KEY-BLIND by design. The reveal key never travels
 * via URL query, request body, or header. The dashboard's
 * EncryptedReveal client component reads `window.location.hash`,
 * fetches /blob, and decrypts in the browser via lib/crypto.
 *
 * BDD lines from story-v0.3.0-private-receipts.md covered here:
 *   - m4 "locked API response uses entries: undefined"
 *   - m4 "/api/verify/<id>?k=<key>" PATH IS REMOVED (key-blind)
 *   - m4 "server log has NO k= value" — implicit (route ignores ?k=)
 *   - m4 "blob endpoint returns encrypted envelope"
 *   - cross-cutting: backward compat with legacy plaintext receipts
 */

import { createCipheriv, randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ZG_TESTNET_RPC ??= "https://evmrpc-testnet.0g.ai";
process.env.ZG_INDEXER_RPC ??= "https://indexer-storage-testnet-turbo.0g.ai";
process.env.AGENTICID_ADDRESS ??= "0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F";
process.env.CHAIN_ID ??= "16602";

import { GET as getProof } from "@/app/api/verify/[tokenId]/route";
import { GET as getBlob } from "@/app/api/verify/[tokenId]/blob/route";
import { __setCachedClientsForTests } from "@/lib/verify-proof";

const VALID_ROOT_HASH = `0x${"a".repeat(64)}`;
const SESSION_ID = "ses_encrypted_01";
const MODEL_ID = "claude-sonnet-4-6";

/**
 * Build a v1 AES-256-GCM envelope JSON suitable for use as a 0G Storage
 * blob payload. Mirrors the on-wire shape produced by
 * `openclaw-skills/.../src/crypto.ts` so the dashboard parser sees a
 * realistic encrypted-receipt blob.
 */
function makeEncryptedBlob(plaintext: string): {
  arrayBuffer: () => Promise<ArrayBuffer>;
  envelope: { v: 1; alg: "aes-256-gcm"; iv: string; ciphertext: string; tag: string };
} {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Wire format mirrors openclaw-skills/.../src/crypto.ts exactly:
  // lowercase alg, hex-encoded iv/ciphertext/tag (no 0x prefix).
  const envelope = {
    v: 1 as const,
    alg: "aes-256-gcm" as const,
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    tag: tag.toString("hex"),
  };
  const json = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(json);
  return {
    envelope,
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return buf;
    },
  };
}

function makePlaintextBlob(): {
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  const json = JSON.stringify({
    sessionId: SESSION_ID,
    startedAt: 1700000000000,
    endedAt: 1700000000500,
    agentId: `0x${"a".repeat(40)}`,
    containerHash: `0x${"c".repeat(64)}`,
    modelId: MODEL_ID,
    entries: [
      {
        seq: 0,
        ts: 1700000000050,
        type: "tool_call",
        tool: "web_search",
        inputHash: "a".repeat(64),
        outputHash: "b".repeat(64),
      },
    ],
    entryCount: 1,
  });
  const bytes = new TextEncoder().encode(json);
  return {
    arrayBuffer: async () => {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return buf;
    },
  };
}

function installFakeClients(blob: { arrayBuffer: () => Promise<ArrayBuffer> }) {
  __setCachedClientsForTests({
    provider: {} as never,
    agenticIdClient: {
      contractAddress: process.env.AGENTICID_ADDRESS!,
      getIntelligentDatas: async () => [
        { dataDescription: `exec-log:${SESSION_ID}:${MODEL_ID}`, dataHash: VALID_ROOT_HASH },
      ],
    } as never,
    indexer: {
      downloadToBlob: async () => [blob, null],
    } as never,
    verifier: {} as never,
    env: {
      ZG_RPC: process.env.ZG_TESTNET_RPC!,
      ZG_INDEXER_RPC: process.env.ZG_INDEXER_RPC!,
      AGENTICID_ADDRESS: process.env.AGENTICID_ADDRESS!,
      CHAIN_ID: 16602,
      TEE_VERIFIER_ADDRESS: `0x${"a".repeat(40)}`,
    },
  });
}

beforeEach(() => {
  __setCachedClientsForTests(null);
});

describe("GET /api/verify/[tokenId] — encrypted receipt", () => {
  // BDD m4: "locked API response uses entries: undefined" — Codex
  // round-1 caught entries: []; this test pins entries-key OMITTED.
  it("returns verified='encrypted' with entries OMITTED (not []) for an encrypted blob", async () => {
    const { arrayBuffer } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    installFakeClients({ arrayBuffer });

    const response = await getProof(new Request("http://localhost:3000/api/verify/42"), {
      params: Promise.resolve({ tokenId: "42" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.verified).toBe("encrypted");
    // The discriminator: entries is omitted, not coerced to an array.
    expect(body.entries).toBeUndefined();
    // Client needs these to do client-side ethers verification.
    expect((body.meta as Record<string, unknown>).rpcUrl).toMatch(/^https?:\/\//);
    expect((body.meta as Record<string, unknown>).verifierAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    // v0.3.4-15: normal exec-log: anchor → recoveryAnchor === false on
    // the encrypted return path. (Plaintext path is asserted in
    // verifier-route.test.ts.)
    expect((body.meta as Record<string, unknown>).recoveryAnchor).toBe(false);
  });

  // Codex round-3 v0.3.4-15: assert recoveryAnchor surfaces ON THE
  // ENCRYPTED RETURN PATH too (verify-proof.ts has two `meta:`
  // construction sites — the encrypted-locked at line ~416 and the
  // plaintext at line ~474; both must propagate the flag).
  it("v0.3.4-15: orphan-recovery anchor surfaces meta.recoveryAnchor === true on the encrypted path", async () => {
    const { arrayBuffer } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    // Inline the fake clients with the orphan prefix (the default
    // installFakeClients hardcodes `exec-log:`).
    __setCachedClientsForTests({
      provider: {} as never,
      agenticIdClient: {
        contractAddress: process.env.AGENTICID_ADDRESS!,
        getIntelligentDatas: async () => [
          {
            dataDescription: `exec-log-orphan:${SESSION_ID}:${MODEL_ID}`,
            dataHash: VALID_ROOT_HASH,
          },
        ],
      } as never,
      indexer: {
        downloadToBlob: async () => [{ arrayBuffer }, null],
      } as never,
      verifier: {} as never,
      env: {
        ZG_RPC: process.env.ZG_TESTNET_RPC!,
        ZG_INDEXER_RPC: process.env.ZG_INDEXER_RPC!,
        AGENTICID_ADDRESS: process.env.AGENTICID_ADDRESS!,
        CHAIN_ID: 16602,
        TEE_VERIFIER_ADDRESS: `0x${"a".repeat(40)}`,
      },
    });

    const response = await getProof(
      new Request("http://localhost:3000/api/verify/99"),
      { params: Promise.resolve({ tokenId: "99" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.verified).toBe("encrypted");
    // The dataDescription round-trips with the orphan prefix...
    expect((body.meta as Record<string, unknown>).dataDescription).toBe(
      `exec-log-orphan:${SESSION_ID}:${MODEL_ID}`,
    );
    // ...and the boolean drives the dashboard's "Orphan recovery
    // anchor" badge in SessionView (badge render itself is verified
    // by Epic-5 Playwright visual baselines, not unit tests — keeps
    // dashboard test infra free of jsdom + RTL just for one
    // conditional badge).
    expect((body.meta as Record<string, unknown>).recoveryAnchor).toBe(true);
  });

  // Defense-in-depth: even if a buggy caller appends ?k=... to the
  // route, the server MUST NOT honor it. This test exercises the
  // hostile-caller scenario.
  it("ignores ?k=<key> on the proof route (route is key-blind by design)", async () => {
    const { arrayBuffer } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    installFakeClients({ arrayBuffer });

    const response = await getProof(
      new Request("http://localhost:3000/api/verify/42?k=ATTACKER_SUPPLIED_KEY"),
      { params: Promise.resolve({ tokenId: "42" }) },
    );

    // Server response is IDENTICAL with or without ?k=: still encrypted,
    // still entries-omitted. The route signature drops `?k=` parsing.
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.verified).toBe("encrypted");
    expect(body.entries).toBeUndefined();
  });

  // Cross-cutting backward-compat: legacy plaintext receipts still
  // render via /api/verify/<id> directly (no /blob hop, no client
  // decryption). The encrypted-only paths must NOT regress this.
  it("returns full entries[] for legacy plaintext receipts (no /blob round-trip)", async () => {
    installFakeClients(makePlaintextBlob());
    const response = await getProof(new Request("http://localhost:3000/api/verify/0"), {
      params: Promise.resolve({ tokenId: "0" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.verified).toBe("preview"); // no signed entries
    expect(Array.isArray(body.entries)).toBe(true);
    expect((body.entries as unknown[]).length).toBe(1);
  });
});

// Codex round-4 P1: real OpenClaw sessionKeys contain ":" — the
// plugin writes them VERBATIM into dataDescription as
// "exec-log:<colon-laden-sessionId>:<modelId>". The dashboard parser
// must round-trip them correctly, both for encrypted locked-state
// metadata and for legacy plaintext SESSION_ID_MISMATCH guard.
describe("GET /api/verify/[tokenId] — colon-containing sessionId (real VPS sessions)", () => {
  const COLON_SESSION = "agent:core:telegram:direct:8028166336";
  const COLON_DESCRIPTION = `exec-log:${COLON_SESSION}:${MODEL_ID}`;

  it("returns full sessionId (not the prefix truncated at the first colon) for encrypted blobs", async () => {
    const { arrayBuffer } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    __setCachedClientsForTests({
      provider: {} as never,
      agenticIdClient: {
        contractAddress: process.env.AGENTICID_ADDRESS!,
        getIntelligentDatas: async () => [
          { dataDescription: COLON_DESCRIPTION, dataHash: VALID_ROOT_HASH },
        ],
      } as never,
      indexer: { downloadToBlob: async () => [{ arrayBuffer }, null] } as never,
      verifier: {} as never,
      env: {
        ZG_RPC: process.env.ZG_TESTNET_RPC!,
        ZG_INDEXER_RPC: process.env.ZG_INDEXER_RPC!,
        AGENTICID_ADDRESS: process.env.AGENTICID_ADDRESS!,
        CHAIN_ID: 16602,
        TEE_VERIFIER_ADDRESS: `0x${"a".repeat(40)}`,
      },
    });
    const response = await getProof(new Request("http://localhost:3000/api/verify/8028"), {
      params: Promise.resolve({ tokenId: "8028" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.sessionId).toBe(COLON_SESSION);
  });

  it("legacy plaintext receipt with colon-sessionId does NOT trip SESSION_ID_MISMATCH", async () => {
    // The blob's sessionId is the same colon-laden string the
    // dataDescription encodes. Pre-fix, parseSessionIdFromDescription
    // returned "agent" while the blob said the full path → 422.
    const json = JSON.stringify({
      sessionId: COLON_SESSION,
      startedAt: 1700000000000,
      endedAt: 1700000000500,
      agentId: `0x${"a".repeat(40)}`,
      containerHash: `0x${"c".repeat(64)}`,
      modelId: MODEL_ID,
      entries: [
        {
          seq: 0,
          ts: 1700000000050,
          type: "tool_call",
          tool: "web_search",
          inputHash: "a".repeat(64),
          outputHash: "b".repeat(64),
        },
      ],
      entryCount: 1,
    });
    const bytes = new TextEncoder().encode(json);
    const blob = {
      arrayBuffer: async () => {
        const buf = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buf).set(bytes);
        return buf;
      },
    };
    __setCachedClientsForTests({
      provider: {} as never,
      agenticIdClient: {
        contractAddress: process.env.AGENTICID_ADDRESS!,
        getIntelligentDatas: async () => [
          { dataDescription: COLON_DESCRIPTION, dataHash: VALID_ROOT_HASH },
        ],
      } as never,
      indexer: { downloadToBlob: async () => [blob, null] } as never,
      verifier: {} as never,
      env: {
        ZG_RPC: process.env.ZG_TESTNET_RPC!,
        ZG_INDEXER_RPC: process.env.ZG_INDEXER_RPC!,
        AGENTICID_ADDRESS: process.env.AGENTICID_ADDRESS!,
        CHAIN_ID: 16602,
        TEE_VERIFIER_ADDRESS: `0x${"a".repeat(40)}`,
      },
    });
    const response = await getProof(new Request("http://localhost:3000/api/verify/8028"), {
      params: Promise.resolve({ tokenId: "8028" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.sessionId).toBe(COLON_SESSION);
    expect(body.verified).toBe("preview"); // unsigned entries
  });
});

// Codex round-15 P1: pin the "server log has NO k= value" BDD line
// with an explicit test (was implicit via the route signature dropping
// `?k=` parsing). Drive the hostile-`?k=` path through the route and
// assert no Node logging surface receives the attacker-supplied key.
describe("GET /api/verify/[tokenId] — `?k=` attacker value never reaches server logs", () => {
  it("does NOT write '?k=' or the attacker key to console / stderr / stdout", async () => {
    const ATTACKER_KEY = "ATTACKER_SUPPLIED_KEY_PAYLOAD";
    const captured: string[] = [];
    const record = (chunk: unknown) => {
      if (typeof chunk === "string") captured.push(chunk);
      else if (chunk instanceof Buffer) captured.push(chunk.toString("utf8"));
      else captured.push(String(chunk));
    };
    // Cover the full Node logging surface — anything a careless
    // implementation could plausibly use.
    const spies = [
      vi.spyOn(console, "log").mockImplementation(record),
      vi.spyOn(console, "warn").mockImplementation(record),
      vi.spyOn(console, "error").mockImplementation(record),
      vi.spyOn(console, "info").mockImplementation(record),
      vi.spyOn(console, "debug").mockImplementation(record),
      vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
        record(c);
        return true;
      }),
      vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
        record(c);
        return true;
      }),
    ];

    const { arrayBuffer } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    installFakeClients({ arrayBuffer });
    const response = await getProof(
      new Request(`http://localhost:3000/api/verify/42?k=${ATTACKER_KEY}`),
      { params: Promise.resolve({ tokenId: "42" }) },
    );
    // Sanity: the route still returns the encrypted state (route is
    // signature-key-blind; ?k= is silently ignored).
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.verified).toBe("encrypted");

    const all = captured.join("");
    // The attacker-supplied key MUST NOT appear in ANY log sink.
    expect(all).not.toContain(ATTACKER_KEY);
    // Defense in depth: even the `?k=` marker shouldn't show up — if a
    // request URL were logged it would carry the key by association.
    expect(all).not.toContain("?k=");

    for (const spy of spies) spy.mockRestore();
  });
});

describe("GET /api/verify/[tokenId]/blob — encrypted envelope passthrough", () => {
  it("returns the envelope JSON for an encrypted blob", async () => {
    const { arrayBuffer, envelope } = makeEncryptedBlob('{"sessionId":"x","entries":[]}');
    installFakeClients({ arrayBuffer });

    const response = await getBlob(new Request("http://localhost:3000/api/verify/42/blob"), {
      params: Promise.resolve({ tokenId: "42" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.v).toBe(1);
    expect(body.alg).toBe("aes-256-gcm");
    expect(body.iv).toBe(envelope.iv);
    expect(body.ciphertext).toBe(envelope.ciphertext);
    expect(body.tag).toBe(envelope.tag);
  });

  it("returns 422 BLOB_NOT_ENCRYPTED for legacy plaintext receipts", async () => {
    installFakeClients(makePlaintextBlob());
    const response = await getBlob(new Request("http://localhost:3000/api/verify/0/blob"), {
      params: Promise.resolve({ tokenId: "0" }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("BLOB_NOT_ENCRYPTED");
  });
});
