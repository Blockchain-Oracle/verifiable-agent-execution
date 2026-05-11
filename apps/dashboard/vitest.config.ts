import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
