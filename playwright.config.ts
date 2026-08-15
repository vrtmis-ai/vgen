import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

const e2eWebUrl = "http://127.0.0.1:5182";

/**
 * `.env.e2e` used to be selected by Vite's `--mode e2e`. Next has no equivalent
 * flag, so the file is read here and injected into the dev server's environment
 * instead. Real process env outranks every `.env*` file in Next's precedence
 * order, which is what lets these override the `.env` demo defaults.
 */
const e2eEnv = config({ path: ".env.e2e", quiet: true }).parsed ?? {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["line"]] : "list",
  /**
   * Playwright's 5s default is a dev-server budget here, not a product one. Next
   * compiles each route the first time it is requested, and six parallel workers
   * hitting six cold routes push the first navigation to ~5s on its own — so the
   * default makes the suite a coin flip on machine load rather than on the app.
   * A warm route navigates in ~100ms, so a real regression still fails, later.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL: e2eWebUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "next dev --hostname 127.0.0.1 --port 5182",
    url: e2eWebUrl,
    env: e2eEnv,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
