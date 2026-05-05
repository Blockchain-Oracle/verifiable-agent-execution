/**
 * Tests for packages/tee-adapter/src/HeaderParser.ts
 *
 * BDD acceptance from context/docs/stories/story-tee-header-parser.md:
 *   - Given the four X-* headers (X-Agent-Id, X-Seal-Id, X-Signature,
 *     X-Timestamp), HeaderParser.parse() returns AgentWrapperAttestation.
 *   - One missing header → AgentWrapperHeaderMissingError naming the missing one.
 *   - X-Signature wrong byte length → AgentWrapperSignatureLengthError.
 *   - X-Timestamp not a base-10 unsigned integer → AgentWrapperTimestampFormatError.
 *   - The parsed signature decodes to exactly 65 bytes (TEEVerifier require).
 *
 * Wire-format note: agent-wrapper writes X-Signature WITHOUT an 0x prefix
 * (per the upstream Go code in sealed/state.go). Tests cover both forms;
 * the parser normalizes to 0x-prefixed.
 */

import { getBytes } from "ethers";
import { describe, expect, it } from "vitest";

import {
  AgentWrapperHeaderMissingError,
  AgentWrapperSignatureLengthError,
  AgentWrapperTimestampFormatError,
  HeaderParser,
} from "../src/index.js";

const AGENT_ID_HEX_NO_0X = "1".repeat(40);
const AGENT_ID_HEX = `0x${AGENT_ID_HEX_NO_0X}`;
const SEAL_ID_HEX_NO_0X = "2".repeat(64);
const SEAL_ID_HEX = `0x${SEAL_ID_HEX_NO_0X}`;
const SIG_HEX_NO_0X = "3".repeat(130); // 65 bytes
const SIG_HEX = `0x${SIG_HEX_NO_0X}`;
const TIMESTAMP_RAW = "1712787654";

function buildHeaders(overrides?: Record<string, string | null>): Headers {
  const base: Record<string, string> = {
    "X-Agent-Id": AGENT_ID_HEX,
    "X-Seal-Id": SEAL_ID_HEX,
    "X-Signature": SIG_HEX_NO_0X, // wire form: no 0x prefix
    "X-Timestamp": TIMESTAMP_RAW,
  };
  const headers = new Headers();
  for (const [k, v] of Object.entries(base)) {
    const override = overrides?.[k];
    if (override === null) continue; // explicitly omit
    headers.set(k, override ?? v);
  }
  return headers;
}

describe("HeaderParser.parse — happy paths", () => {
  it("parses all four headers and returns a typed attestation", () => {
    const result = HeaderParser.parse(buildHeaders());
    expect(result.agentId).toBe(AGENT_ID_HEX);
    expect(result.sealId).toBe(SEAL_ID_HEX);
    expect(result.signature).toBe(SIG_HEX); // normalized to 0x-prefixed
    expect(result.timestamp).toBe(1_712_787_654);
  });

  it("normalizes a signature that already has 0x prefix (idempotent)", () => {
    const result = HeaderParser.parse(buildHeaders({ "X-Signature": SIG_HEX }));
    expect(result.signature).toBe(SIG_HEX);
  });

  it("normalizes an agentId that lacks 0x prefix", () => {
    const result = HeaderParser.parse(
      buildHeaders({ "X-Agent-Id": AGENT_ID_HEX_NO_0X }),
    );
    expect(result.agentId).toBe(AGENT_ID_HEX);
  });

  it("normalizes a sealId that lacks 0x prefix", () => {
    const result = HeaderParser.parse(
      buildHeaders({ "X-Seal-Id": SEAL_ID_HEX_NO_0X }),
    );
    expect(result.sealId).toBe(SEAL_ID_HEX);
  });

  it("returns a signature that ethers.getBytes decodes to exactly 65 bytes", () => {
    const result = HeaderParser.parse(buildHeaders());
    const bytes = getBytes(result.signature);
    expect(bytes.length).toBe(65);
  });
});

describe("HeaderParser.parse — missing-header errors", () => {
  it("throws AgentWrapperHeaderMissingError when X-Agent-Id is absent", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Agent-Id": null })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperHeaderMissingError",
        headerName: "X-Agent-Id",
      }) as unknown as Error);
  });

  it("throws AgentWrapperHeaderMissingError when X-Seal-Id is absent", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Seal-Id": null })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperHeaderMissingError",
        headerName: "X-Seal-Id",
      }) as unknown as Error);
  });

  it("throws AgentWrapperHeaderMissingError when X-Signature is absent", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Signature": null })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperHeaderMissingError",
        headerName: "X-Signature",
      }) as unknown as Error);
  });

  it("throws AgentWrapperHeaderMissingError when X-Timestamp is absent", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Timestamp": null })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperHeaderMissingError",
        headerName: "X-Timestamp",
      }) as unknown as Error);
  });
});

describe("HeaderParser.parse — wrong signature length", () => {
  it("throws AgentWrapperSignatureLengthError on a 64-byte sig (128 hex chars)", () => {
    const tooShort = "a".repeat(128);
    expect(() => HeaderParser.parse(buildHeaders({ "X-Signature": tooShort })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperSignatureLengthError",
        actualByteLength: 64,
      }) as unknown as Error);
  });

  it("throws AgentWrapperSignatureLengthError on a 66-byte sig (132 hex chars)", () => {
    const tooLong = "b".repeat(132);
    expect(() => HeaderParser.parse(buildHeaders({ "X-Signature": tooLong })))
      .toThrow(AgentWrapperSignatureLengthError);
  });

  it("reports byteLength=0 for non-hex input", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Signature": "not-hex-at-all" })))
      .toThrowError(expect.objectContaining({
        name: "AgentWrapperSignatureLengthError",
        actualByteLength: 0,
      }) as unknown as Error);
  });
});

describe("HeaderParser.parse — timestamp format errors", () => {
  it("throws AgentWrapperTimestampFormatError on a non-numeric timestamp", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Timestamp": "abc" })))
      .toThrow(AgentWrapperTimestampFormatError);
  });

  it("throws AgentWrapperTimestampFormatError on a negative-sign timestamp", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Timestamp": "-1" })))
      .toThrow(AgentWrapperTimestampFormatError);
  });

  it("throws AgentWrapperTimestampFormatError on a float timestamp", () => {
    expect(() => HeaderParser.parse(buildHeaders({ "X-Timestamp": "1.5" })))
      .toThrow(AgentWrapperTimestampFormatError);
  });

  it("accepts timestamp = 0 (boundary)", () => {
    const result = HeaderParser.parse(buildHeaders({ "X-Timestamp": "0" }));
    expect(result.timestamp).toBe(0);
  });
});
