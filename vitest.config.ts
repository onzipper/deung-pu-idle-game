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
    // R2-W2 "fullscreen HUD": one RTL smoke test needs a DOM (jsdom) — rather
    // than flip the GLOBAL environment (which would slow down every pure
    // engine/*.test.ts file), `.test.tsx` files opt into jsdom per-file via a
    // `// @vitest-environment jsdom` docblock (vitest's documented override
    // mechanism). Every other `.test.ts` file keeps the fast Node environment
    // untouched.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**"],
    },
  },
});
