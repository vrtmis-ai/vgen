import { z } from "zod";

export const InputValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const InputMapSchema = z.record(z.string(), InputValueSchema);

/**
 * What a screen asks a price for.
 *
 * Deliberately richer than what goes on the wire. The studio knows the family,
 * the reference slots and the control values as separate things, and flattening
 * them here would push that translation into every caller. The HTTP adapter
 * narrows it to the `{variantId, params, prompt}` the API accepts — which is
 * the whole reason an adapter exists.
 */
export const QuoteGenerationRequestSchema = z.object({
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  prompt: z.string(),
  input: InputMapSchema,
  referenceAssetIds: z.record(z.string(), z.array(z.string().min(1))).default({}),
  /** "I would rather wait than spend." See the wire contract for why this is a
   *  preference the server may decline rather than a billing instruction. */
  preferUnlimited: z.boolean().optional(),
});

/**
 * A price the server stands behind. Mirrors `GenerationQuoteSchema` in
 * `packages/contracts/src/generation.ts`.
 *
 * `coins` is authoritative and zero is a real answer, not a missing one:
 * `unlimited` is present exactly when the zero came from a grant, so a screen
 * can say why it is free and what is left of today.
 *
 * It is not a whole number. Generations bill in hundredths of a coin
 * (MICRO_CREDITS_PER_BILLED_STEP), so a cheap model quotes 0.16 rather than
 * rounding up to 1 — see the note on that constant.
 */
export const GenerationQuoteSchema = z.object({
  id: z.string().min(1),
  coins: z.number().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  unlimited: z
    .object({
      remainingToday: z.number().int().nonnegative().nullable(),
      dailyCap: z.number().int().positive().nullable(),
    })
    .optional(),
  concurrency: z.object({
    running: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
});

export const CreateGenerationRequestSchema = z.object({
  quoteId: z.string().min(1),
  /** Travels as the `Idempotency-Key` header, not in the body. */
  idempotencyKey: z.string().min(16).max(128),
  /** Must hash to exactly what was quoted, or the server refuses it. */
  input: InputMapSchema,
});

/**
 * Mirrors the `jobs_status_check` constraint, because inventing a second
 * vocabulary is what made the browser's old copy unable to parse a real reply.
 *
 * `succeeded`, not `done`. The word the database uses is the word that comes
 * over the wire, and translating it here would only move the mismatch.
 */
export const JobStatusSchema = z.enum(["draft", "queued", "running", "succeeded", "failed", "cancelled", "expired"]);

export const GeneratedOutputSchema = z.object({
  assetId: z.string().min(1),
  /**
   * Signed and short-lived. Store `assetId` if something has to be remembered;
   * this is a loan, not an address.
   */
  url: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document"]),
  mimeType: z.string().min(1),
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

/**
 * A generation, in whatever state it has reached.
 *
 * One shape for what `POST /jobs` answers, what `GET /generation/jobs/:id`
 * answers, and what a page of the gallery is made of — a gallery item *is* a
 * job. The previous version of this file described a fourth thing that no
 * server ever sent: it required `updatedAt` and `outputAssetIds`, named its
 * statuses differently, and would have failed to parse every real reply.
 */
export const GenerationJobSchema = z.object({
  id: z.string().min(1),
  status: JobStatusSchema,
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  /** Charged in hundredths of a coin, so not a whole number. */
  coins: z.number().nonnegative(),
  prompt: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  outputs: z.array(GeneratedOutputSchema),
  /** When every `url` above stops working. Null while there is nothing to expire. */
  urlsExpireAt: z.number().int().nonnegative().nullable(),
  /**
   * Why it failed. Every one of these codes ends in a refund — the worker
   * either captures the hold because a file exists or releases it because one
   * does not, and `GENERATION_ERROR_MESSAGES` says so to the customer.
   */
  error: z.object({ code: z.string().min(1), message: z.string() }).optional(),
});

export type QuoteGenerationRequest = z.input<typeof QuoteGenerationRequestSchema>;
export type GenerationQuote = z.infer<typeof GenerationQuoteSchema>;
export type CreateGenerationRequest = z.infer<typeof CreateGenerationRequestSchema>;
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
