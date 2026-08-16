import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/*` → `src/*` alias, restated.
  //
  // Next reads it from tsconfig.json on its own; Vite does not read tsconfig
  // paths at all, so without this every component copied in from the shadcn
  // ecosystem — which imports `@/components/...` and `@/lib/utils` by
  // convention — fails to resolve under the test runner while building fine.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Pinned rather than inherited from tsconfig.json, whose `jsx` value Next
  // rewrites on every build. If a future release changes it, the test runner
  // keeps transforming JSX the same way instead of failing on raw JSX.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
