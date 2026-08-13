import type { AppServices } from "../../app/AppServices";
import { GenerationJobSchema, GenerationQuoteSchema } from "../../app/contracts/generation";
import type { HttpClient } from "./client";

/* ⚠️ NOT WIRED. Every method here 404s against the running API.
 *
 * The API registers exactly one generation route, `POST /api/v1/jobs`. There is
 * no quote endpoint and no job-status endpoint, and nothing anywhere creates a
 * row in `quotes` — yet `createQueued` takes a `quoteId` and reads that table,
 * so even the route that does exist cannot be reached through a supported flow.
 *
 * Renaming these three paths would not fix it, which is why they have been left
 * alone: the shapes disagree as well. The API answers with
 * `{id, status, modelKey, quotedCredits, createdAt}` while GenerationJobSchema
 * here requires `{familyId, variantId, updatedAt, outputAssetIds, …}`, so a
 * path-only change would trade a 404 for a schema error and make the gap look
 * smaller than it is.
 *
 * What it needs, in order: a quote endpoint that prices params and writes the
 * quote row; one shared job shape between packages/contracts and
 * app/contracts/generation; `GET /api/v1/jobs/:id` over the existing
 * `getForUser`, which now returns a job in any state rather than only 'queued'.
 *
 * In demo mode this file is not used, which is why the UI works there.
 */
export function createHttpGenerationService(client: HttpClient): AppServices["generation"] {
  return {
    quote(request, options) {
      return client.request("/generation/quotes", {
        method: "POST",
        body: request,
        schema: GenerationQuoteSchema,
        signal: options?.signal,
      });
    },
    create(request, options) {
      return client.request("/generation/jobs", {
        method: "POST",
        body: request,
        schema: GenerationJobSchema,
        signal: options?.signal,
      });
    },
    getJob(jobId, options) {
      return client.request(`/generation/jobs/${encodeURIComponent(jobId)}`, {
        schema: GenerationJobSchema,
        signal: options?.signal,
      });
    },
  };
}
