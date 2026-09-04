import type { AppServices } from "../../runtime/AppServices";
import { GenerationJobSchema, GenerationQuoteSchema } from "../../runtime/contracts/generation";
import type { HttpClient } from "./client";

/**
 * The generation half of the API, finally reachable.
 *
 * This file used to be three methods that all 404'd, under a comment listing
 * what the server would need first. It has all of it now — a quote endpoint, a
 * submit endpoint and a job endpoint, all speaking one job shape — so what is
 * left here is the narrowing this layer exists to do.
 *
 * The port speaks the studio's language: a family, a variant, control values,
 * reference slots. The API accepts a variant and a bag of params, and nothing
 * else — deliberately, because a request that could name its own feature, model
 * or price is a request that could ask to be billed as something cheaper. So
 * the mapping happens here rather than in a screen.
 */
export function createHttpGenerationService(client: HttpClient): AppServices["generation"] {
  return {
    quote(request, options) {
      return client.request("/generation/quotes", {
        method: "POST",
        body: {
          variantId: request.variantId,
          /* The prompt goes *inside* the settings, and that is the whole point
             rather than a detail.

             `params` is not only what gets hashed. The worker hands it to the
             provider as the request body verbatim (`input: request.params`),
             and the gallery reads the prompt back out of it with
             `params ->> 'prompt'`. A prompt sent only as the sibling field
             below is priced correctly, charged correctly, and then reaches
             nobody — the provider is asked for a 1:1 image with no subject and
             the customer pays for whatever it invents. Verified against a real
             KIE generation: with the prompt in `params` the result matches it.

             Folded here in both calls rather than by either caller, so the two
             bodies cannot drift into a `params_mismatch`. */
          params: { ...request.input, prompt: request.prompt },
          // Still its own field: this is the billable character count for the
          // models that charge per 1k characters, which is a different job.
          prompt: request.prompt,
          // The field #55 built and this adapter used to drop on the floor.
          // Sent always, including empty: the server schema defaults it, but an
          // absent key and an empty object mean subtly different things to a
          // reader and only one of them is what the screen intended.
          referenceAssetIds: request.referenceAssetIds,
          // Sent only when the screen has an opinion. The server reads an
          // absent field as "free if I am entitled", which is what every
          // caller wanted before there was a switch to say otherwise.
          ...(request.preferUnlimited === undefined ? {} : { preferUnlimited: request.preferUnlimited }),
        },
        schema: GenerationQuoteSchema,
        signal: options?.signal,
      });
    },
    create(request, options) {
      return client.request("/jobs", {
        method: "POST",
        // The params have to hash to exactly what was quoted, so they are sent
        // again rather than remembered server-side against the quote id. That
        // is what stops a cheap quote being redeemed for an expensive job.
        // Folded exactly as in `quote` above — same inputs, same object, so the
        // hash matches.
        body: { quoteId: request.quoteId, params: { ...request.input, prompt: request.prompt } },
        // A header, not a body field: it identifies the attempt rather than the
        // request, and the server reads it before parsing anything.
        headers: { "Idempotency-Key": request.idempotencyKey },
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
