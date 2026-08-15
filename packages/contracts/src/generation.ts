import { z } from "zod";

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
