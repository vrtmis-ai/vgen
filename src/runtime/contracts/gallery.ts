import { z } from "zod";
import { JobStatusSchema } from "./generation";

export const GenerationSummarySchema = z.object({
  id: z.string().min(1),
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().min(1),
  kind: z.enum(["image", "video", "audio"]),
  prompt: z.string(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  outputUrl: z.string().url().optional(),
  createdAt: z.number().int().nonnegative(),
});

export const GalleryPageSchema = z.object({
  items: z.array(GenerationSummarySchema),
  nextCursor: z.string().min(1).optional(),
});

export interface GalleryQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  kind?: "image" | "video" | "audio" | undefined;
}

export type GalleryPage = z.infer<typeof GalleryPageSchema>;
