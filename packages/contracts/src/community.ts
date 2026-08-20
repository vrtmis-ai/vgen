import { z } from "zod";

/**
 * The community feed: creations users chose to publish into the app.
 *
 * Not editorial content, and not in `content_items` for that reason — a post
 * is a moderated user submission with an owner, a consent record and a
 * moderation state, and `posts` has modelled all three since 0001.
 *
 * Nothing here carries `status`. The route serves approved posts only, so it
 * could never read anything else, and the screens that used to filter on it
 * were each one forgotten call away from showing a rejected submission to
 * everybody.
 *
 * Nothing here carries the author's user id either. A display handle is all a
 * feed card needs, and shipping an internal id to every visitor turns a public
 * feed into an enumeration of the user table.
 */
export const CommunityPostSchema = z.object({
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
