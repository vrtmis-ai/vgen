import type { Page, Route } from "@playwright/test";
import { FAMILIES } from "../src/data/models";

export interface ApiScenario {
  anonymous?: boolean;
  quoteErrorCode?: string;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function mockApi(page: Page, scenario: ApiScenario = {}): Promise<void> {
  let jobReads = 0;
  await page.route("**/api/v1/session", (route) =>
    json(
      route,
      scenario.anonymous
        ? { status: "anonymous", host: "web" }
        : {
            status: "authed",
            host: "web",
            user: { id: "e2e-user", methods: ["email"], emailNormalized: "e2e@vgen.local", displayName: "E2E User" },
          },
    ),
  );
  await page.route("**/api/v1/catalog", (route) => json(route, { version: "e2e-v1", publishedAt: 1, families: FAMILIES }));
  await page.route("**/api/v1/wallet", (route) => json(route, { spendable: 1000, grants: [] }));
  await page.route("**/api/v1/gallery**", (route) => json(route, { items: [] }));
  await page.route("**/api/v1/generation/quotes", (route) => {
    if (scenario.quoteErrorCode) {
      return json(route, { error: { code: scenario.quoteErrorCode, message: "raw provider text", requestId: "req-e2e" } }, 422);
    }
    return json(route, { id: "quote-1", coins: 7, expiresAt: Date.now() + 300_000, catalogVersion: "e2e-v1" });
  });
  await page.route("**/api/v1/generation/jobs", (route) =>
    json(route, {
      id: "job-1",
      familyId: "z-image",
      variantId: "z-image",
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputAssetIds: [],
    }),
  );
  await page.route("**/api/v1/generation/jobs/job-1", (route) => {
    jobReads += 1;
    return json(route, {
      id: "job-1",
      familyId: "z-image",
      variantId: "z-image",
      status: jobReads > 1 ? "done" : "running",
      progress: jobReads > 1 ? 100 : 45,
      createdAt: 1,
      updatedAt: Date.now(),
      outputAssetIds: [],
    });
  });
}
