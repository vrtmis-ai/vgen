import type { AppServices } from "../../app/AppServices";
import { GenerationJobSchema, GenerationQuoteSchema } from "../../app/contracts/generation";
import type { HttpClient } from "./client";

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
