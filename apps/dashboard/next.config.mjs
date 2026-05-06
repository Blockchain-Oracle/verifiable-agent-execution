/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages have raw TypeScript in their `main`/`exports`
  // fields rather than pre-built JS — Next.js needs to transpile them.
  transpilePackages: [
    "@verifiable-agent-execution/chain-client",
    "@verifiable-agent-execution/logger",
    "@verifiable-agent-execution/tee-adapter",
  ],
  // The chain-client + logger packages call into ethers and the 0G
  // SDK from server components / route handlers — Next.js's bundling
  // for `node:crypto` etc. needs server-only externals.
  // (Next 14 key — `serverExternalPackages` is the Next 15 rename;
  // we'll switch when we upgrade.)
  experimental: {
    serverComponentsExternalPackages: [
      "ethers",
      "@0gfoundation/0g-storage-ts-sdk",
      "@0gfoundation/0g-compute-ts-sdk",
    ],
  },
  // Strict-mode catches accidental double-renders in dev — same defaults
  // as the next-forge baseline.
  reactStrictMode: true,
  // Workspace packages use ESM-style `.js` extensions in their imports
  // (per the Node 16+ ESM convention TypeScript recommends), but the
  // actual files are `.ts`. TypeScript handles this transparently via
  // its module resolution; webpack does not. extensionAlias tells
  // webpack to fall through to .ts/.tsx when a .js import doesn't
  // resolve — same fix the Vercel docs recommend for monorepos that
  // ship raw TypeScript in packages.
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
