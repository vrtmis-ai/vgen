import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".next/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "scripts/**/*.ts", "e2e/**/*.ts", "apps/**/*.ts", "packages/**/*.ts", "*.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
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
