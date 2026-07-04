import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Headless engine tests run in a Node environment — no DOM. This is the whole
// point of keeping `engine/` pure: balance + combat are testable without a browser.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**"],
    },
  },
});
