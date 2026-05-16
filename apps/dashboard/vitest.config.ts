import { defineConfig } from "vitest/config";

export default defineConfig({
  // v0.3.4: match Next.js's React 18 automatic JSX runtime so the
  // SessionView/FeedTable .test.tsx files (which import the
  // components as authored — no `import React from "react"`) compile
  // under vitest's esbuild transform too. Without this, esbuild
  // defaults to the classic runtime and the components throw
  // "React is not defined" when rendered.
  esbuild: { jsx: "automatic" },
  test: {
    // v0.3.4: `.test.tsx` picked up for SessionView/FeedTable
    // recovery-badge render tests (Codex r5 v0.3.4-15 closing). Uses
    // `react-dom/server` renderToStaticMarkup — no jsdom/happy-dom
    // needed; pure string render of the conditional JSX.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text", "json-summary"],
    },
  },
  resolve: {
    alias: {
      // Mirror the tsconfig paths "@/*" → "./src/*" so test imports
      // can use the same alias as production code.
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
