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

/**
 * Sharing something you made into the feed.
 *
 * The request names a job rather than an asset, a caption or a family, because
 * every one of those is already known from the job and none of them should be
 * the caller's to assert. A client that could choose the family could put its
 * post under a model that never ran it; a client that could choose the author
 * could publish as somebody else.
 *
 * `consent` is `true` and nothing else on purpose. §14 requires the author's
 * agreement to expose the prompt, the settings and any reference files, taken
 * **at share time** — so it is a field the caller has to send rather than a
 * default this schema could quietly supply. An omitted consent is a rejected
 * request, which is the only reading of silence that is safe here.
 */
export const SharePostRequestSchema = z
  .object({
    jobId: z.uuid(),
    /** What the card says. Falls back to the job's own prompt when the recipe is shared. */
    caption: z.string().trim().min(1).max(280).optional(),
    /** Whether the prompt travels with the post. Separate from consent: agreeing to publish is not agreeing to publish the recipe. */
    promptVisible: z.boolean().default(true),
    consent: z.literal(true),
  })
  .strict();

/**
 * What comes back. `pending` always, today — nothing here publishes itself.
 *
 * The status is returned rather than assumed because it is the whole answer to
 * "why can I not see it": a share succeeded and a moderator has not looked yet.
 */
export const SharedPostSchema = z.object({
  id: z.uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
});

/** One row of the moderation queue. Staff-only, so it carries what the feed deliberately does not. */
export const PendingPostSchema = z.object({
  id: z.uuid(),
  author: z.string().min(1),
  kind: z.enum(["image", "video", "reel"]),
  familyId: z.string().min(1),
  caption: z.string(),
  /** The recipe, and whether the author agreed to show it. A moderator sees it either way; the feed does not. */
  prompt: z.string(),
  promptVisible: z.boolean(),
  submittedAt: z.number().int().nonnegative(),
});

export const PendingPostsSchema = z.object({ posts: z.array(PendingPostSchema) });

export const ModeratePostRequestSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** Recorded on the row for a rejection. Never shown in the feed, which never carries rejected posts at all. */
    reason: z.string().trim().max(280).optional(),
  })
  .strict();

export type SharePostRequest = z.infer<typeof SharePostRequestSchema>;
export type SharedPost = z.infer<typeof SharedPostSchema>;
export type PendingPost = z.infer<typeof PendingPostSchema>;
export type PendingPosts = z.infer<typeof PendingPostsSchema>;
export type ModeratePostRequest = z.infer<typeof ModeratePostRequestSchema>;
