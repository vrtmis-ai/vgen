import { defineConfig, devices } from "@playwright/test";

const e2eWebUrl = "http://127.0.0.1:5182";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["line"]] : "list",
  use: {
    baseURL: e2eWebUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --mode e2e --host 127.0.0.1 --port 5182 --strictPort",
    url: e2eWebUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
