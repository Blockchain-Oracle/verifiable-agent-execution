/**
 * build.mjs — produce a self-contained, npm-publishable plugin bundle.
 *
 * What this exists for:
 *   OpenClaw's `--link` install scans the plugin's `node_modules/` and
 *   rejects symlinks whose target lives outside the plugin's install
 *   root. pnpm workspace deps (`workspace:*`) are exactly such
 *   symlinks (they resolve into the workspace's `.pnpm/` store).
 *   Bundling all runtime deps into one file removes the problem: the
 *   shipped artifact has no `node_modules/` at all.
 *
 *   This same bundle is the artifact we npm-publish: subscribers run
 *   `openclaw plugins install npm:@blockchainoracle/openclaw-verifiable-execution`
 *   and OpenClaw extracts a tarball that contains exactly this dist.
 *
 * What it does:
 *   1. esbuild src/index.ts → dist-plugin/verifiable-execution/index.js
 *      (esm, node20, single file, all deps inlined except node:* and
 *      `openclaw/*` which OpenClaw provides at runtime).
 *   2. Copies openclaw.plugin.json into the dist dir.
 *   3. Writes a minimal, publishable package.json next to it.
 *
 * Run: pnpm --filter @verifiable-agent-execution/openclaw-skill build
 *      (or: node openclaw-skills/verifiable-execution/build.mjs)
 */

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SRC_MANIFEST = resolve(SCRIPT_DIR, "openclaw.plugin.json");
const SRC_PKG_JSON = resolve(SCRIPT_DIR, "package.json");
const OUT_DIR = resolve(REPO_ROOT, "dist-plugin", "verifiable-execution");

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Bundle. `openclaw/plugin-sdk/core` is provided by OpenClaw at runtime
//    (evermemos has no openclaw dep and just imports from there) — mark
//    every `openclaw/*` specifier external. node: built-ins are external
//    by default with platform=node, but listed explicitly for clarity.
// ---------------------------------------------------------------------------

const NODE_BUILTINS = [
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:os",
  "node:path",
  "node:url",
  "node:util",
  "node:stream",
  "node:buffer",
  "node:events",
];

console.log("[build] bundling src/index.ts → dist-plugin/verifiable-execution/index.js");
const result = await build({
  entryPoints: [resolve(SCRIPT_DIR, "src", "index.ts")],
  outfile: resolve(OUT_DIR, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  // `openclaw` and any submodule (`openclaw/plugin-sdk/core` etc.) must
  // stay external — OpenClaw injects its own SDK at load time. Without
  // this, esbuild would inline an older SDK copy and break version
  // contracts with the host.
  external: ["openclaw", "openclaw/*", ...NODE_BUILTINS],
  // Don't minify — we want the published bundle readable so anyone
  // installing from npm can audit what's actually running in their
  // OpenClaw process. The "verifiable" in the name extends to the
  // plugin source itself.
  minify: false,
  sourcemap: "linked",
  legalComments: "external",
  logLevel: "info",
  // banner: keep the package origin visible in any stack trace.
  banner: {
    js: "// @blockchainoracle/openclaw-verifiable-execution — bundled with esbuild",
  },
});

if (result.errors.length > 0) {
  for (const err of result.errors) console.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Copy openclaw.plugin.json (the OpenClaw manifest the CLI reads to
//    validate `pluginConfig` against `configSchema`).
// ---------------------------------------------------------------------------

await cp(SRC_MANIFEST, resolve(OUT_DIR, "openclaw.plugin.json"));
console.log("[build] copied openclaw.plugin.json");

// ---------------------------------------------------------------------------
// 3. Write a minimal, publishable package.json. The source plugin
//    package.json carries workspace metadata (private:true,
//    workspace:* deps, vitest config) that npm-publish doesn't want.
//    Reading the source name/version/description as the source of truth
//    so a `pnpm version` bump in the workspace plugin propagates here
//    automatically.
// ---------------------------------------------------------------------------

const sourcePkg = JSON.parse(await readFile(SRC_PKG_JSON, "utf8"));

const distPkg = {
  // Personal scope of the npm user `blockchainoracle`. First publish
  // with `--access public` auto-claims the package under the scope.
  name: "@blockchainoracle/openclaw-verifiable-execution",
  version: sourcePkg.version,
  description: sourcePkg.description,
  type: "module",
  main: "./index.js",
  // OpenClaw reads `openclaw.extensions` to know which file(s) to load.
  // Point at the bundled output — same shape evermemos uses, minus the
  // /src indirection.
  openclaw: {
    extensions: ["./index.js"],
  },
  // Allowlist the files that ship in the npm tarball. `index.js` +
  // `openclaw.plugin.json` are the only runtime artefacts; the LICENSE
  // and README ride along for npm hygiene.
  files: ["index.js", "index.js.map", "openclaw.plugin.json", "README.md", "LICENSE"],
  peerDependencies: {
    // OpenClaw provides `openclaw/plugin-sdk/core` at runtime — the
    // plugin needs the host to be >= a version that exposes the SDK
    // we built against.
    openclaw: ">=2026.4.25",
  },
  engines: {
    node: ">=20",
  },
  keywords: [
    "openclaw",
    "openclaw-plugin",
    "0g",
    "0g-storage",
    "agenticid",
    "erc-7857",
    "inft",
    "verifiable-agent",
    "agent-receipts",
  ],
  // Repo/homepage/bugs let `npm view` surface useful pointers. These
  // are also what `openclaw plugins info <pkg>` will show to operators
  // browsing for a verifiable-execution plugin.
  repository: {
    type: "git",
    url: "git+https://github.com/Blockchain-Oracle/verifiable-agent-execution.git",
    directory: "openclaw-skills/verifiable-execution",
  },
  homepage:
    "https://github.com/Blockchain-Oracle/verifiable-agent-execution#readme",
  bugs: {
    url: "https://github.com/Blockchain-Oracle/verifiable-agent-execution/issues",
  },
  license: "Apache-2.0",
  publishConfig: {
    access: "public",
  },
};

await writeFile(
  resolve(OUT_DIR, "package.json"),
  JSON.stringify(distPkg, null, 2) + "\n",
);
console.log("[build] wrote dist package.json");

// ---------------------------------------------------------------------------
// 4. Drop a minimal README into the bundle so the npm page isn't blank.
//    Points at the canonical docs in the repo — the README's job here
//    is just to be a landing card on npmjs.com.
// ---------------------------------------------------------------------------

const distReadme = `# @blockchainoracle/openclaw-verifiable-execution

OpenClaw plugin that captures every tool call inside an agent session,
**encrypts the log with a per-session AES-256-GCM key**, flushes the
encrypted envelope to **0G Storage**, and mints an **AgenticID iNFT**
anchoring the rootHash on-chain.

**Encrypted by default.** The plugin outputs a key-free
\`https://agentscan.online/verify/<tokenId>\` URL. Cold visitors see
a 🔒 Encrypted locked-state page (proof chain verifiable cold, content
hidden). When the operator chooses to share, they type \`/share\` in
the bot chat — the bot replies with the full URL including a
\`#k=<base64url-key>\` fragment. Recipients who open that URL decrypt
client-side in their browser via WebCrypto; the key NEVER reaches the
verifier server.

## Install

\`\`\`bash
openclaw plugins install npm:@blockchainoracle/openclaw-verifiable-execution
openclaw gateway restart
\`\`\`

Then set your config in \`~/.openclaw/openclaw.json\` (see [docs](https://github.com/Blockchain-Oracle/verifiable-agent-execution/blob/main/docs/installation.md)).

## What it does

- **Captures** every \`after_tool_call\` and \`session_end\` event
- **Hashes** tool params + results (sha256, no plaintext to chain)
- **Anchors** the session Merkle root on **AgenticID** (ERC-7857 iNFT)
- **Publishes** a verify URL the dashboard can resolve without a wallet

## Networks

| Network | chainId | AgenticID | MockTEEVerifier |
|---|---|---|---|
| 0G Galileo (testnet) | 16602 | \`0xd4a5eA2501810d7C81464aa3CdBa58Bfded09E38\` | \`0x058fc372562D195F1c2356e4DcFfD94de98Ec3ad\` |
| 0G Aristotle (mainnet) | 16661 | \`0xC6f7fB1511a7483C6e14258c70529e37ec698937\` | \`0x4fffB58B488bBeD9f072Ad68EeB77F643b8858D2\` |

## License

Apache-2.0. See \`LICENSE\` and the [source repo](https://github.com/Blockchain-Oracle/verifiable-agent-execution).
`;
await writeFile(resolve(OUT_DIR, "README.md"), distReadme);
console.log("[build] wrote dist README.md");

// ---------------------------------------------------------------------------
// 5. Copy LICENSE if the repo has one. Skip silently if missing.
// ---------------------------------------------------------------------------

try {
  await cp(resolve(REPO_ROOT, "LICENSE"), resolve(OUT_DIR, "LICENSE"));
  console.log("[build] copied LICENSE");
} catch {
  console.warn("[build] no LICENSE at repo root — skipping");
}

console.log(`[build] ✓ self-contained plugin at ${OUT_DIR}`);
console.log(`[build]   install for local test: openclaw plugins install --link ${OUT_DIR}`);
console.log(`[build]   publish to npm:        cd ${OUT_DIR} && npm publish --access public`);
