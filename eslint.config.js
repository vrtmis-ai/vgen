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
      // ignoreRestSiblings, because `const { variants, ...presentation } = family`
      // is how you omit a key, and the omitted one is the point rather than an
      // oversight. Passing options at all replaces the rule's defaults, which is
      // why it has to be named here.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // What the browser bundle is not allowed to contain.
    //
    // These three files name our suppliers, their endpoint paths, and what a
    // generation costs us. A JSON import is inlined into the bundle whether or
    // not any code reads the fields, so "we only import it for one value" is not
    // a defence — every one of these leaked exactly that way before.
    //
    // Anything under app/ or src/ ships. The seeders in scripts/ do not, which
    // is why they may read them.
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/data/upstream.json", "**/data/upstream.pricing.json", "**/data/routes.wavespeed.json"],
              message:
                "Server-only: this names a supplier, its endpoints, or our cost, and app/ and src/ are shipped to the browser. Read it from scripts/ instead.",
            },
          ],
        },
      ],
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
