import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
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
