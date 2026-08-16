import { z } from "zod";

/**
 * What the browser asks a price for.
 *
 * It names a variant and its settings, and nothing else. In particular it does
 * not name a feature, a model id or a price — those are catalogue facts the
 * server looks up, and a request that could name them is a request that could
 * ask to be billed as something cheaper than it is.
 */
export const QuoteGenerationRequestSchema = z
  .object({
    variantId: z.string().min(1).max(120),
    params: z.record(z.string(), z.unknown()).default({}),
    /** Priced for the models that bill per 1k characters; ignored by the rest. */
    prompt: z.string().max(20_000).default(""),
    /**
     * Length of an attached clip, for the models that bill by the second of
     * input rather than of output.
     *
     * Client-supplied and therefore provisional: it is the one billing quantity
     * the server cannot yet check, because the asset it describes is not stored
     * until the assets phase. It becomes a lookup against the asset row then,
     * and this field goes.
     */
    clipSeconds: z.number().positive().max(3600).optional(),
  })
  .strict();

/**
 * A price the server stands behind.
 *
 * `coins` is authoritative and always present — zero is a real answer, not a
 * missing one. `unlimited` is present only when the zero came from a grant
 * rather than from a free price, so the UI can say why and show what is left.
 */
export const GenerationQuoteSchema = z.object({
  id: z.uuid(),
  coins: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  unlimited: z
    .object({
      /** Null when the grant is genuinely uncapped. */
      remainingToday: z.number().int().nonnegative().nullable(),
      dailyCap: z.number().int().positive().nullable(),
    })
    .optional(),
  /**
   * What the account has in flight against what its plan allows.
   *
   * Always present, because it is always true — the price is not the only
   * reason a generation might not start. Quoting is deliberately not refused
   * when the account is at its limit: the price is still the price, and a
   * client that knows it is full can say "3 of 3 running" rather than
   * discovering it by being rejected. The refusal itself belongs at
   * submission, where the count cannot go stale between the two calls.
   */
  concurrency: z.object({
    running: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
});

export const CreateGenerationJobSchema = z
  .object({
    quoteId: z.uuid(),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();

export const GenerationIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);

/** Mirrors the jobs_status_check constraint. */
export const GenerationJobStatusSchema = z.enum(["queued", "submitted", "running", "succeeded", "failed", "cancelled", "expired"]);

export const QueuedGenerationJobSchema = z.object({
  id: z.uuid(),
  // Was z.literal("queued"), which the replay path could not honour: it returns
  // whatever job already exists for that idempotency key, in whatever state.
  status: GenerationJobStatusSchema,
  modelKey: z.string().min(1),
  quotedCredits: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
});

export type CreateGenerationJob = z.infer<typeof CreateGenerationJobSchema>;
export type QueuedGenerationJob = z.infer<typeof QueuedGenerationJobSchema>;
export type QuoteGenerationRequest = z.infer<typeof QuoteGenerationRequestSchema>;
export type GenerationQuote = z.infer<typeof GenerationQuoteSchema>;
