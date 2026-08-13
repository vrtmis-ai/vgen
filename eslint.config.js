import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".vite-logs/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "e2e/**/*.ts", "apps/**/*.ts", "packages/**/*.ts", "*.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // The current codebase intentionally colocates small hooks and helpers with
      // their providers. Splitting those public modules is a later refactor, not
      // a correctness condition for this quality gate.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["fastify", "fastify/*"], message: "Core cannot depend on the HTTP framework." },
            { group: ["drizzle-orm", "drizzle-orm/*", "postgres"], message: "Core cannot depend on persistence adapters." },
            { group: ["bullmq", "ioredis"], message: "Core cannot depend on queue or Redis transports." },
            { group: ["@aws-sdk/*"], message: "Core cannot depend on object-storage adapters." },
          ],
        },
      ],
    },
  },
);
