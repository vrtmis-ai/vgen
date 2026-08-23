import {
  CommunityFeedSchema,
  PendingPostsSchema,
  SharedPostSchema,
  type CommunityFeed,
  type PendingPosts,
  type SharedPost,
} from "@vgen/contracts";
import type { Sql } from "postgres";
import { isBannedFromPublishing } from "./bansRepository";

/**
 * The community feed, read out of `posts`.
 *
 * Three filters, and each one is a different way a post can stop being public:
 * `status = 'approved'` is the moderator's decision, `deleted_at is null` is the
 * author's, and `consent_at is not null` is the author's agreement to expose the
 * prompt and settings at all. A post can pass the first two and fail the third
 * — a moderator approving something never creates consent — so all three are
 * asked rather than assuming approval implies the rest.
 *
 * The picture is still a placeholder keyed by `metadata.seed`. When posts carry
 * a real rendered asset this reads `public_url` instead and the seed goes.
 */
export interface CustomerCommunityRepository {
  list(limit?: number): Promise<CommunityFeed>;
}

export class PostgresCommunityRepository implements CustomerCommunityRepository {
  constructor(private readonly sql: Sql) {}

  async list(limit = 60): Promise<CommunityFeed> {
    const rows = await this.sql<
      {
        id: string;
        author: string | null;
        kind: string | null;
        family_code: string | null;
        caption: string | null;
        seed: string | null;
        aspect_w: number | null;
        aspect_h: number | null;
        like_count: number;
      }[]
    >`
      select
        post.id,
        coalesce(author.handle, author.display_name) as author,
        post.kind, post.family_code, post.caption,
        cover.metadata ->> 'seed' as seed,
        (cover.metadata ->> 'aspectW')::int as aspect_w,
        (cover.metadata ->> 'aspectH')::int as aspect_h,
        post.like_count
      from posts post
      join users author on author.id = post.author_user_id
      left join assets cover on cover.id = post.cover_asset_id
      where post.status = 'approved'
        and post.deleted_at is null
        and post.consent_at is not null
      order by post.published_at desc nulls last, post.id desc
      limit ${limit}
    `;

    // A row missing any of these cannot be rendered — no author to credit, no
    // picture to show, no model to open. Dropped rather than thrown on, unlike
    // the content route: one malformed post must not empty the whole feed, and
    // there is no admin waiting on this the way there is on a pulled effect.
    const posts = rows.flatMap((row) =>
      row.author && row.kind && row.family_code && row.caption && row.seed && row.aspect_w && row.aspect_h
        ? [
            {
              id: row.id,
              author: row.author,
              kind: row.kind,
              familyId: row.family_code,
              prompt: row.caption,
              seed: row.seed,
              w: row.aspect_w,
              h: row.aspect_h,
              likes: Number(row.like_count),
            },
          ]
        : [],
    );

    return CommunityFeedSchema.parse({ posts });
  }
}

/** Why a share did not happen. Each one is a different thing for the caller to do about it. */
export type ShareOutcome =
  | { outcome: "shared"; post: SharedPost }
  | { outcome: "banned" }
  | { outcome: "unknown_job" }
  | { outcome: "not_finished" }
  | { outcome: "nothing_to_show" }
  | { outcome: "already_shared" };

export interface SharePostInput {
  userId: string;
  jobId: string;
  caption?: string | undefined;
  promptVisible: boolean;
}

/**
 * Turning a finished generation into a pending post.
 *
 * Everything the post carries is read from the job rather than accepted from
 * the caller — the author, the account, the model family, the picture and the
 * prompt. A request that could name its own family could file a post under a
 * model that never ran it; one that could name its own author could publish as
 * somebody else. The only two things the caller decides are the caption and
 * whether the recipe travels with it.
 *
 * Nothing here publishes. A post lands `pending` and a moderator moves it, and
 * that is the schema's own default rather than a policy this file invented.
 */
export class PostgresCommunitySubmissions {
  constructor(private readonly sql: Sql) {}

  async share(input: SharePostInput): Promise<ShareOutcome> {
    // Before anything is read or written. An `explore` or `platform` ban is
    // specifically a bar on publishing — it deliberately does not stop signing
    // in or generating, and until this route existed it had nothing to refuse.
    if (await isBannedFromPublishing(this.sql, input.userId)) return { outcome: "banned" };

    const [job] = await this.sql<
      {
        account_id: string;
        created_by: string;
        status: string;
        prompt: string | null;
        family_code: string | null;
        asset_id: string | null;
        asset_kind: string | null;
        already: string | null;
      }[]
    >`
      select
        job.account_id,
        job.created_by,
        job.status,
        job.params ->> 'prompt' as prompt,
        model.family as family_code,
        cover.id as asset_id,
        cover.kind as asset_kind,
        shared.id as already
      from jobs job
      left join provider_models model on model.id = job.provider_model_id
      -- The cover is the first output, and "first" is the batch position the
      -- provider gave it rather than the id: asset ids are UUIDv7 and two rows
      -- written in the same millisecond sort by their random bits.
      left join lateral (
        select asset.id, asset.kind
        from assets asset
        where asset.job_id = job.id and asset.origin = 'generated' and asset.deleted_at is null
        order by asset.output_index, asset.created_at
        limit 1
      ) cover on true
      left join posts shared
        on shared.job_id = job.id and shared.deleted_at is null
      where job.id = ${input.jobId}
        and job.account_id = (select personal_account_id from users where id = ${input.userId})
      limit 1
    `;

    // A job on somebody else's account answers `unknown_job` rather than a
    // refusal, deliberately: telling a stranger that an id exists but is not
    // theirs turns this route into a way to confirm ids by guessing them.
    if (!job) return { outcome: "unknown_job" };
    if (job.status !== "succeeded") return { outcome: "not_finished" };
    if (job.already) return { outcome: "already_shared" };

    // `posts.kind` allows image, video and reel. An audio generation has no
    // card the feed knows how to draw, and a job whose outputs were deleted has
    // nothing to show at all — both are refusals rather than posts with a hole.
    const kind = job.asset_kind === "image" || job.asset_kind === "video" ? job.asset_kind : null;
    if (!job.asset_id || !kind || !job.family_code) return { outcome: "nothing_to_show" };

    // The feed draws the caption as the post's prompt. Falling back to the
    // job's own prompt is only right when the author agreed to show the recipe;
    // otherwise an empty caption would publish the very thing they withheld.
    const caption = input.caption ?? (input.promptVisible ? (job.prompt ?? null) : null);
    if (!caption) return { outcome: "nothing_to_show" };

    const [row] = await this.sql<{ id: string; status: string }[]>`
      insert into posts (
        account_id, author_user_id, job_id, cover_asset_id, caption,
        prompt_visible, kind, family_code, status, submitted_at, consent_at
      ) values (
        ${job.account_id}, ${job.created_by}, ${input.jobId}, ${job.asset_id}, ${caption},
        ${input.promptVisible}, ${kind}, ${job.family_code}, 'pending', now(), now()
      )
      -- Two shares of one job arriving together: the second reads nothing above,
      -- because the first has inserted and not committed, and lands here
      -- instead. Returning no row is read as the race it was.
      on conflict do nothing
      returning id, status
    `;
    if (!row) return { outcome: "already_shared" };

    return { outcome: "shared", post: SharedPostSchema.parse({ id: row.id, status: row.status }) };
  }
}

/**
 * The moderation queue.
 *
 * Separate from the feed repository because they are opposite surfaces: one is
 * read by anyone with a browser and carries the least it can, the other is read
 * by staff and carries the prompt whether or not the author agreed to show it.
 * A moderator deciding whether something may be published has to see what made
 * it, and that is exactly what the feed must not hand out.
 */
export class PostgresCommunityModeration {
  constructor(private readonly sql: Sql) {}

  async listPending(limit = 100): Promise<PendingPosts> {
    const rows = await this.sql<
      {
        id: string;
        author: string | null;
        kind: string | null;
        family_code: string | null;
        caption: string | null;
        prompt: string | null;
        prompt_visible: boolean;
        submitted_at: Date | null;
      }[]
    >`
      select
        post.id,
        coalesce(author.handle, author.display_name) as author,
        post.kind, post.family_code, post.caption,
        job.params ->> 'prompt' as prompt,
        post.prompt_visible,
        post.submitted_at
      from posts post
      join users author on author.id = post.author_user_id
      left join jobs job on job.id = post.job_id
      where post.status = 'pending' and post.deleted_at is null
      order by post.submitted_at asc nulls last, post.id asc
      limit ${limit}
    `;

    return PendingPostsSchema.parse({
      posts: rows.map((row) => ({
        id: row.id,
        author: row.author ?? "—",
        kind: row.kind === "video" || row.kind === "reel" ? row.kind : "image",
        familyId: row.family_code ?? "unknown",
        caption: row.caption ?? "",
        prompt: row.prompt ?? "",
        promptVisible: row.prompt_visible,
        submittedAt: row.submitted_at?.getTime() ?? 0,
      })),
    });
  }

  /**
   * Approve or reject one post. Answers null when it is not there to decide on.
   *
   * The update matches `status = 'pending'` and not the id alone, so two
   * moderators reaching the same row cannot each believe theirs was the
   * decision: the second matches nothing and answers null, and the audit log
   * then holds one entry for what happened rather than two that disagree.
   */
  async decide(postId: string, decision: "approve" | "reject", reason?: string): Promise<{ status: string } | null> {
    const approving = decision === "approve";
    const [row] = await this.sql<{ status: string }[]>`
      update posts set
        status = ${approving ? "approved" : "rejected"},
        published_at = case when ${approving} then now() else published_at end,
        rejection_reason = ${approving ? null : (reason ?? null)},
        updated_at = now()
      where id = ${postId} and status = 'pending' and deleted_at is null
      returning status
    `;
    return row ?? null;
  }
}
