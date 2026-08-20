import { CommunityFeedSchema, type CommunityFeed } from "@vgen/contracts";
import type { Sql } from "postgres";

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
