import { z } from "zod";
import { GenerationJobSchema } from "./generation";

/**
 * A page of the account's own generations.
 *
 * An item is a job — not a summary of one. There used to be a
 * `GenerationSummarySchema` here carrying `name`, `vendor` and `grad` beside
 * the ids, which meant the server was expected to send catalogue presentation
 * back to a browser that already holds the whole catalogue. Those three are
 * derived from `variantId` through `useCatalogFamilies()`, where they cannot
 * drift from what the switcher shows.
 */
export const GalleryPageSchema = z.object({
  items: z.array(GenerationJobSchema),
  /** Absent on the last page. Opaque — pass it back, do not parse it. */
  nextCursor: z.string().min(1).optional(),
});

export interface GalleryQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  kind?: "image" | "video" | "audio" | undefined;
}

export type GalleryPage = z.infer<typeof GalleryPageSchema>;
