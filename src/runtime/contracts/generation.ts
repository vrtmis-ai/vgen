import { z } from "zod";

export const InputValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const InputMapSchema = z.record(z.string(), InputValueSchema);

export const QuoteGenerationRequestSchema = z.object({
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  prompt: z.string(),
  input: InputMapSchema,
  referenceAssetIds: z.record(z.string(), z.array(z.string().min(1))).default({}),
});

export const GenerationQuoteSchema = z.object({
  id: z.string().min(1),
  coins: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  catalogVersion: z.string().min(1),
});

export const CreateGenerationRequestSchema = z.object({
  quoteId: z.string().min(1),
  idempotencyKey: z.string().min(16).max(128),
});

export const JobStatusSchema = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export const GenerationJobSchema = z.object({
  id: z.string().min(1),
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  outputAssetIds: z.array(z.string().min(1)).default([]),
  error: z.object({ code: z.string().min(1), message: z.string(), requestId: z.string().min(1).optional() }).optional(),
});

export type QuoteGenerationRequest = z.input<typeof QuoteGenerationRequestSchema>;
export type GenerationQuote = z.infer<typeof GenerationQuoteSchema>;
export type CreateGenerationRequest = z.infer<typeof CreateGenerationRequestSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
