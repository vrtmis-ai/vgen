import type { Page, Route } from "@playwright/test";
import { FAMILIES } from "../src/data/models";
/**
 * The snapshot itself, not `PLAN_LADDER` from `src/data/plans`.
 *
 * Playwright runs these files through Node's own ESM loader rather than a
 * bundler, and Node insists on the import attribute below for JSON. Reaching
 * through `plans.ts` would pull in the pricing tables' JSON imports as well,
 * which do not carry one — and do not need one, because everything else that
 * imports them is bundled. The file is already the exact `GET /plans` payload.
 */
import planPayload from "../src/data/plans.snapshot.json" with { type: "json" };
/* Both are the exact payloads their routes serve, generated out of Postgres and
   committed — so the browser under test parses what production sends. */
import contentPayload from "../src/data/content.snapshot.json" with { type: "json" };
import communityPayload from "../src/data/community.snapshot.json" with { type: "json" };

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
        ? { status: "anonymous", host: "web", authProviders: [] }
        : {
            status: "authed",
            host: "web",
            // A deployment with neither provider configured, which is the
            // common one. The sign-in screen draws no social buttons for it.
            authProviders: [],
            user: { id: "e2e-user", methods: ["email"], emailNormalized: "e2e@vgen.local", displayName: "E2E User" },
          },
    ),
  );
  await page.route("**/api/v1/catalog", (route) => json(route, { version: "e2e-v1", publishedAt: 1, families: FAMILIES }));
  // Served to anonymous visitors too — the landing page prices two plans from it.
  await page.route("**/api/v1/plans", (route) => json(route, planPayload));
  // Both served to anonymous visitors: the landing page's feature bento renders
  // effects, courses and a voice count, and its showcase strip renders posts.
  // Without these the shell waits on content forever and never paints.
  // `flags` is required on the content document and the shell blocks on it, so
  // a fixture that forgets it paints the "content failed to load" screen and
  // every landing assertion fails at once — which is exactly what it did.
  await page.route("**/api/v1/content", (route) =>
    json(route, { version: "e2e-v1", publishedAt: 1, flags: { siteBanner: true }, ...contentPayload }),
  );
  await page.route("**/api/v1/community", (route) => json(route, communityPayload));
  await page.route("**/api/v1/wallet", (route) => json(route, { spendable: 1000, grants: [] }));
  await page.route("**/api/v1/gallery**", (route) => json(route, { items: [] }));
  await page.route("**/api/v1/generation/quotes", (route) => {
    if (scenario.quoteErrorCode) {
      return json(route, { error: { code: scenario.quoteErrorCode, message: "raw provider text", requestId: "req-e2e" } }, 422);
    }
    // `concurrency` is always present on a real quote — the price is not the
    // only reason a generation might not start.
    return json(route, {
      id: "quote-1",
      coins: 7,
      expiresAt: Date.now() + 300_000,
      concurrency: { running: 0, limit: 3 },
    });
  });

  /**
   * One shape for the job, because the API has one.
   *
   * `POST /jobs`, `GET /generation/jobs/:id` and a gallery item all answer with
   * `GenerationJobSchema`, so a fixture that invented a fourth shape would pass
   * against a browser that no longer accepts it.
   */
  const job = (overrides: Record<string, unknown> = {}) => ({
    id: "job-1",
    familyId: "z-image",
    variantId: "z-image",
    status: "queued",
    coins: 7,
    prompt: "A quiet forest",
    createdAt: 1,
    updatedAt: Date.now(),
    outputs: [],
    urlsExpireAt: null,
    ...overrides,
  });

  // Submission is `POST /jobs`, not `/generation/jobs`. Reading one back is
  // `/generation/jobs/:id`; the two paths are genuinely different.
  await page.route("**/api/v1/jobs", (route) => json(route, job(), 202));
  await page.route("**/api/v1/generation/jobs/job-1", (route) => {
    jobReads += 1;
    // `succeeded`, the word the database uses. `done` was the browser's own
    // invention and no server ever sent it.
    return json(
      route,
      jobReads > 1
        ? job({
            status: "succeeded",
            outputs: [
              {
                assetId: "asset-1",
                url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
                kind: "image",
                mimeType: "image/gif",
                width: 1,
                height: 1,
                durationMs: null,
              },
            ],
            urlsExpireAt: Date.now() + 3_600_000,
          })
        : job({ status: "running" }),
    );
  });
  await page.route("**/api/v1/assets", (route) =>
    json(
      route,
      {
        id: "asset-1",
        url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        kind: "image",
        mimeType: "image/png",
        byteSize: 8,
        deduplicated: false,
        urlExpiresAt: Date.now() + 3_600_000,
      },
      201,
    ),
  );
}
