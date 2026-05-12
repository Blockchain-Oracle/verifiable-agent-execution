/**
 * Tests for src/share-command.ts — /share slash command handler.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateKey, shareStringToKey } from "../src/crypto.js";
import { Keystore } from "../src/keystore.js";
import { handleShareCommand } from "../src/share-command.js";

let root: string;
let keystore: Keystore;
const VERIFY_URL_BASE = "https://verifiable.0g.ai";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ve-share-cmd-"));
  keystore = new Keystore({ root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("handleShareCommand — happy paths", () => {
  it("returns URL for the most recent receipt when no args given", () => {
    const k = generateKey();
    keystore.setPending("ses-1", k);
    keystore.commitPending("ses-1", "7");

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share" },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/tokenId 7/);
    expect(result.reply?.text).toMatch(
      new RegExp(`${VERIFY_URL_BASE}/verify/7#k=[A-Za-z0-9_-]+`),
    );
  });

  it("returns URL for a specific tokenId from numeric arg in content", () => {
    keystore.put("3", generateKey());
    keystore.put("7", generateKey());

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share 3" },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/tokenId 3/);
    expect(result.reply?.text).toContain(`${VERIFY_URL_BASE}/verify/3#k=`);
  });

  it("emitted key in URL fragment round-trips through shareStringToKey", () => {
    const k = generateKey();
    keystore.put("99", k);

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share 99" },
    );

    const match = result.reply!.text.match(/#k=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    const decoded = shareStringToKey(match![1]!);
    expect(decoded.equals(k)).toBe(true);
  });

  it("accepts structured args (Discord-style slash command)", () => {
    keystore.put("42", generateKey());

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { args: ["42"] },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/tokenId 42/);
  });

  it("treats 'last' keyword as no-args (uses getLast)", () => {
    const k = generateKey();
    keystore.setPending("ses-recent", k);
    keystore.commitPending("ses-recent", "11");

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share last" },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/tokenId 11/);
  });
});

describe("handleShareCommand — edge cases", () => {
  it("returns a friendly 'no receipts yet' message when keystore is empty", () => {
    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share" },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/No receipts yet/);
    // Must NOT leak any URL or key string when there are no receipts.
    expect(result.reply?.text).not.toContain("#k=");
    expect(result.reply?.text).not.toContain("/verify/");
  });

  it("returns 'no key on this host' when tokenId exists nowhere in keystore", () => {
    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share 999" },
    );

    expect(result.handled).toBe(true);
    expect(result.reply?.text).toMatch(/No key on this host for tokenId 999/);
    expect(result.reply?.text).not.toContain("#k=");
  });

  it("includes the session footnote when using last-receipt path", () => {
    keystore.setPending("agent:core:telegram:direct:8028166336", generateKey());
    keystore.commitPending("agent:core:telegram:direct:8028166336", "7");

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share" },
    );

    expect(result.reply?.text).toContain(
      "agent:core:telegram:direct:8028166336",
    );
  });

  it("does NOT leak session info when an explicit tokenId is given", () => {
    keystore.setPending("ses-private", generateKey());
    keystore.commitPending("ses-private", "7");

    const result = handleShareCommand(
      { keystore, verifyUrlBase: VERIFY_URL_BASE },
      { content: "/share 7" },
    );
    // Explicit-tokenId path doesn't include the session footnote.
    expect(result.reply?.text).not.toContain("ses-private");
  });

  it("strips trailing slashes from verifyUrlBase before building URL", () => {
    keystore.put("7", generateKey());
    const result = handleShareCommand(
      { keystore, verifyUrlBase: "https://verifiable.0g.ai/" },
      { content: "/share 7" },
    );
    // Should NOT contain a double-slash before /verify.
    expect(result.reply?.text).not.toMatch(/\.0g\.ai\/\/verify/);
    expect(result.reply?.text).toContain("https://verifiable.0g.ai/verify/7");
  });
});
