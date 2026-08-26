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
    /**
     * A preference, not an instruction — which is why it is a mood and not a
     * price.
     *
     * The note above is right that a request able to name a feature is a
     * request able to ask to be billed as something cheaper. This one names no
     * feature, no model and no price: it says the customer would rather wait
     * than spend, and the server decides whether that is available to them by
     * looking up the same three things it already looks up — does this family
     * have the pipe, does this account hold the entitlement, and is today's cap
     * already reached. A `true` here can only ever make a generation slower.
     *
     * The answer comes back on the quote's `unlimited` field, so the browser
     * learns what actually happened rather than assuming it got what it asked
     * for.
     */
    preferUnlimited: z.boolean().optional(),
  })
  .strict();

/**
 * A price the server stands behind.
 *
 * `coins` is authoritative and always present — zero is a real answer, not a
 * missing one. `unlimited` is present only when the zero came from a grant
 * rather than from a free price, so the UI can say why and show what is left.
 *
 * Not a whole number: generations bill in hundredths of a coin, so a cheap
 * model quotes 0.16 instead of rounding up to 1. See
 * MICRO_CREDITS_PER_BILLED_STEP in @vgen/core.
 */
export const GenerationQuoteSchema = z.object({
  id: z.uuid(),
  coins: z.number().nonnegative(),
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
export const GenerationJobStatusSchema = z.enum(["draft", "queued", "running", "succeeded", "failed", "cancelled", "expired"]);

/**
 * One file a generation produced.
 *
 * `url` is signed and expires. Nothing here is a public object: a generation
 * belongs to whoever paid for it, and a bucket set to public-read is a bucket
 * where guessing a key is enough. Treat the URL as a loan, not an address —
 * store the `assetId` if anything needs to be remembered.
 */
export const GeneratedOutputSchema = z.object({
  assetId: z.uuid(),
  url: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document"]),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

/**
 * A generation, in whatever state it has reached.
 *
 * One shape for three things that used to disagree: what `POST /jobs` answers,
 * what `GET /generation/jobs/:id` answers, and what a page of the gallery is
 * made of. A gallery item *is* a job — there was never a second concept, only
 * a second schema, and the browser's copy had drifted far enough that renaming
 * a path would have traded a 404 for a parse error.
 *
 * `familyId` and `variantId` rather than an opaque `modelKey`: the customer
 * chose a variant out of the catalogue and every screen renders from that
 * catalogue, so the ids it is keyed by are what a screen can actually use.
 * Which provider served it stays ours to know.
 */
export const GenerationJobSchema = z.object({
  id: z.uuid(),
  status: GenerationJobStatusSchema,
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  /** What it was quoted at, in hundredths of a coin. Also what it was charged, once it succeeds. */
  coins: z.number().nonnegative(),
  prompt: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  outputs: z.array(GeneratedOutputSchema),
  /**
   * When every `url` above stops working, so a long-lived tab can refresh
   * before showing a broken image rather than after.
   */
  urlsExpireAt: z.number().int().nonnegative().nullable(),
  /**
   * Why it failed. The codes are the worker's, and `docs/API.md` lists them
   * with what a person can do about each — every one of them ends in a refund.
   */
  error: z.object({ code: z.string().min(1), message: z.string() }).optional(),
});

export const GalleryPageSchema = z.object({
  items: z.array(GenerationJobSchema),
  /** Absent on the last page. Opaque — pass it back, do not parse it. */
  nextCursor: z.string().min(1).optional(),
});

export const GalleryQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(60).default(24),
    kind: z.enum(["image", "video", "audio"]).optional(),
  })
  .strict();

export type CreateGenerationJob = z.infer<typeof CreateGenerationJobSchema>;
export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationJobStatus = z.infer<typeof GenerationJobStatusSchema>;
export type GalleryPage = z.infer<typeof GalleryPageSchema>;
export type GalleryQuery = z.infer<typeof GalleryQuerySchema>;
export type QuoteGenerationRequest = z.infer<typeof QuoteGenerationRequestSchema>;
export type GenerationQuote = z.infer<typeof GenerationQuoteSchema>;
