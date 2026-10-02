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
    // The three JSON files name our suppliers, their endpoint paths, and what a
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
          paths: [
            {
              // Not a supplier secret — a size cliff, and the same rule fits it.
              // Turbopack cannot narrow zod's namespace object, so `{ z }` drags
              // in all 63 locales, the JSON-Schema converters and the JIT: 131 KB
              // compressed on every route instead of 35. One import anywhere
              // under src/ puts it all back, and nothing else would notice.
              name: "zod",
              message: "Import `* as z` from src/lib/z, which costs the browser 96 KB less. Server code may import zod directly.",
            },
          ],
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
    // Reached from the browser through @vgen/core, so the same size rule applies.
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "zod",
              message: "Import `* as z` from ./z — these schemas reach the browser through @vgen/core. See packages/contracts/src/z.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    // The two files whose job is to import zod.
    files: ["src/lib/z.ts", "packages/contracts/src/z.ts"],
    rules: { "no-restricted-imports": "off" },
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
