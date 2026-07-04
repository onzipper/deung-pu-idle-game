import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Engine purity boundary: `engine/` is pure TS and must stay headless-testable.
  // Importing UI/render/framework code here is a hard error.
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "engine/ must stay pure — no React." },
            { name: "react-dom", message: "engine/ must stay pure — no React." },
            { name: "pixi.js", message: "engine/ must stay pure — no rendering." },
            { name: "zustand", message: "engine/ must stay pure — no UI store." },
            { name: "next", message: "engine/ must stay pure — no framework." },
          ],
          patterns: [
            {
              group: ["@/render/*", "@/ui/*", "@/server/*", "@/lib/*", "next/*"],
              message: "engine/ must not depend on render/ui/server/lib layers.",
            },
          ],
        },
      ],
    },
  },

  // Turn off formatting rules that conflict with Prettier (keep this last).
  prettier,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
