import { z } from "zod";

/**
 * The community feed, as `GET /community` serves it.
 *
 * Deliberately a copy of `packages/contracts/src/community.ts` rather than an
 * import of it: this is the browser's statement of what it will accept, and
 * the server's is what it promises to send.
 *
 * Nothing here carries `status` or the author's user id. The route serves
 * approved posts only, and a display handle is all a feed card needs — shipping
 * an internal id to every visitor would turn a public feed into an enumeration
 * of the user table.
 */ export const CommunityPostSchema = z.object({
  id: z.uuid(),
  /** Display handle. Changeable, and deliberately not a key. */
  author: z.string().min(1),
  /** A reel is assembled from several shots, so it is not a video with one job behind it. */
  kind: z.enum(["image", "video", "reel"]),
  /** Which model family made it. Denormalised on the row — see migration 0021. */
  familyId: z.string().min(1),
  prompt: z.string().min(1),
  /** Placeholder art key, until posts carry a real rendered asset. */
  seed: z.string().min(1),
  /** Aspect ratio as two integers, so the grid can reserve the box before the image lands. */
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  likes: z.number().int().nonnegative(),
});

export const CommunityFeedSchema = z.object({
  posts: z.array(CommunityPostSchema),
});

export type CommunityPost = z.infer<typeof CommunityPostSchema>;
export type CommunityFeed = z.infer<typeof CommunityFeedSchema>;
