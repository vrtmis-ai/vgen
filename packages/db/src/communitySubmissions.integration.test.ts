import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCommunityModeration, PostgresCommunityRepository, PostgresCommunitySubmissions } from "./communityRepository";
import { connect, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * Sharing a generation into the feed, and the moderator's half of it.
 *
 * The claims worth more than the rest are all about what a caller may not
 * decide: whose job it is, which model it names, and whether it is published.
 * A share request carries a job id and a caption and nothing else, and these
 * tests are what say the rest is read rather than believed.
 */

async function anyVariant(tx: Sql) {
  const [row] = await tx<{ id: string; family: string; feature_id: string }[]>`
    select model.id, model.family, route.feature_id
    from provider_models model
    join feature_model_routes route on route.provider_model_id = model.id
    join features feature on feature.id = route.feature_id
    where model.capabilities ? 'variant' and model.is_active and feature.modality = 'image'
    limit 1
  `;
  if (!row) throw new Error("the seeded catalogue has no active image variant");
  return row;
}

async function seedJob(
  tx: Sql,
  options: { accountId: string; userId: string; status?: string; withOutput?: boolean; prompt?: string; assetKind?: string },
): Promise<{ jobId: string; family: string }> {
  const model = await anyVariant(tx);
  const status = options.status ?? "succeeded";
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (account_id, created_by, feature_id, provider_model_id, params, status, origin, micro_credits_held, micro_credits_charged, completed_at)
    values (
      ${options.accountId}, ${options.userId}, ${model.feature_id}, ${model.id},
      ${tx.json({ prompt: options.prompt ?? "a small red boat" })}, ${status}, 'web',
      ${2 * COIN}, ${status === "succeeded" ? 2 * COIN : 0},
      ${status === "succeeded" ? tx`now()` : null}
    )
    returning id
  `;
  if (options.withOutput !== false) {
    await tx`
      insert into assets (account_id, created_by, kind, origin, job_id, output_index, storage_provider, storage_bucket, storage_key, mime_type, byte_size, sha256)
      values (
        ${options.accountId}, ${options.userId}, ${options.assetKind ?? "image"}, 'generated', ${job!.id}, 0,
        's3', 'vgen', ${`generated/${job!.id}/0.png`}, 'image/png', 4096, ${`hash-${job!.id}`}
      )
    `;
  }
  return { jobId: job!.id, family: model.family };
}

describe("sharing something you made", () => {
  it("files it under the model that actually ran it, credited to you, and not published", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId, family } = await seedJob(tx, { accountId, userId, prompt: "a lighthouse at dusk" });

      const result = await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true });

      expect(result.outcome).toBe("shared");
      const [row] = await tx<
        { status: string; family_code: string; author_user_id: string; account_id: string; caption: string; consent_at: Date | null }[]
      >`
        select status, family_code, author_user_id, account_id, caption, consent_at from posts where job_id = ${jobId}
      `;
      expect(row?.status).toBe("pending");
      // Read off the job, not off the request — the caller never named it.
      expect(row?.family_code).toBe(family);
      expect(row?.author_user_id).toBe(userId);
      expect(row?.account_id).toBe(accountId);
      expect(row?.caption).toBe("a lighthouse at dusk");
      // §14: the agreement is recorded at share time or the post has no right to exist.
      expect(row?.consent_at).not.toBeNull();
    });
  });

  /**
   * The one that would be a real leak. `caption` is what the feed draws as the
   * post's prompt, so falling back to the job's prompt for someone who withheld
   * the recipe would publish exactly the thing they withheld.
   */
  it("never falls back to the prompt of someone who chose not to show it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId, prompt: "my private recipe" });

      const result = await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: false });

      expect(result.outcome).toBe("nothing_to_show");
      const [row] = await tx<{ n: string }[]>`select count(*)::text as n from posts where job_id = ${jobId}`;
      expect(row?.n).toBe("0");
    });
  });

  it("takes the caption over the prompt when both are there", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId, prompt: "the raw prompt" });

      await new PostgresCommunitySubmissions(tx).share({ userId, jobId, caption: "sunset no. 4", promptVisible: false });

      const [row] = await tx<{ caption: string; prompt_visible: boolean }[]>`
        select caption, prompt_visible from posts where job_id = ${jobId}
      `;
      expect(row?.caption).toBe("sunset no. 4");
      expect(row?.prompt_visible).toBe(false);
    });
  });

  it("will not share somebody else's generation, and does not admit it exists", async () => {
    await inRollback(sql, async (tx) => {
      const owner = await makeUser(tx);
      const stranger = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId: owner.accountId, userId: owner.userId });

      const result = await new PostgresCommunitySubmissions(tx).share({ userId: stranger.userId, jobId, promptVisible: true });

      // Not "forbidden": confirming the id exists would make this a way of
      // discovering other people's job ids by guessing them.
      expect(result.outcome).toBe("unknown_job");
    });
  });

  it("refuses a generation that has not finished", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId, status: "running" });

      expect((await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true })).outcome).toBe("not_finished");
    });
  });

  it("refuses one with nothing the feed could draw", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const noOutput = await seedJob(tx, { accountId, userId, withOutput: false });
      const audio = await seedJob(tx, { accountId, userId, assetKind: "audio" });

      const submissions = new PostgresCommunitySubmissions(tx);
      expect((await submissions.share({ userId, jobId: noOutput.jobId, promptVisible: true })).outcome).toBe("nothing_to_show");
      expect((await submissions.share({ userId, jobId: audio.jobId, promptVisible: true })).outcome).toBe("nothing_to_show");
    });
  });

  /**
   * The thing `isBannedFromPublishing` was written for and had nothing to
   * refuse until this route existed. An `explore` ban bars publishing and
   * deliberately nothing else — the account keeps signing in and keeps
   * generating, because it paid for that.
   */
  it("refuses someone banned from publishing, before it reads their job", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId });
      await tx`insert into bans (user_id, scope, reason) values (${userId}, 'explore', 'spam')`;

      expect((await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true })).outcome).toBe("banned");
      const [row] = await tx`select count(*)::text as n from posts where job_id = ${jobId}`;
      expect(row?.["n"]).toBe("0");
    });
  });

  /**
   * A double-tapped button, or a client that resends on timeout after the
   * insert already committed. Two posts of one picture means a moderator
   * reviews it twice and the feed can show it twice in a row.
   */
  it("shares a generation once, however many times it is asked", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId });
      const submissions = new PostgresCommunitySubmissions(tx);

      expect((await submissions.share({ userId, jobId, promptVisible: true })).outcome).toBe("shared");
      expect((await submissions.share({ userId, jobId, promptVisible: true })).outcome).toBe("already_shared");

      const [row] = await tx<{ n: string }[]>`select count(*)::text as n from posts where job_id = ${jobId}`;
      expect(row?.n).toBe("1");
    });
  });
});

describe("the moderator's half", () => {
  it("lists what is waiting, with the prompt whether or not the feed may show it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId, prompt: "a withheld recipe" });
      await new PostgresCommunitySubmissions(tx).share({ userId, jobId, caption: "no. 4", promptVisible: false });

      const queue = await new PostgresCommunityModeration(tx).listPending();
      const mine = queue.posts.find((post) => post.caption === "no. 4");

      expect(mine).toBeDefined();
      // The whole reason this surface is separate from the feed: deciding
      // whether something may be published means seeing what made it.
      expect(mine!.prompt).toBe("a withheld recipe");
      expect(mine!.promptVisible).toBe(false);
    });
  });

  it("publishes on approval, though the feed still cannot draw it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId, prompt: "a lighthouse" });
      const shared = await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true });
      const postId = shared.outcome === "shared" ? shared.post.id : "";

      const decided = await new PostgresCommunityModeration(tx).decide(postId, "approve");

      expect(decided?.status).toBe("approved");
      const [row] = await tx<{ published_at: Date | null }[]>`select published_at from posts where id = ${postId}`;
      expect(row?.published_at).not.toBeNull();

      // And here is the gap this PR does not close, asserted rather than left
      // to be discovered. The feed draws its pictures from a placeholder art
      // key on the cover asset, which a real rendered output does not carry —
      // so an approved post is filtered out of the feed it was approved for.
      // Closing that means being able to serve a customer's file to a browser,
      // which nothing here can do yet and which is a privacy decision rather
      // than a missing function.
      const feed = await new PostgresCommunityRepository(tx).list();
      expect(feed.posts.some((post) => post.id === postId)).toBe(false);
    });
  });

  it("refuses a rejection, records why, and keeps it out of the feed", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId });
      const shared = await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true });
      const postId = shared.outcome === "shared" ? shared.post.id : "";

      expect((await new PostgresCommunityModeration(tx).decide(postId, "reject", "not what this feed is for"))?.status).toBe("rejected");

      const [row] = await tx<{ status: string; rejection_reason: string | null; published_at: Date | null }[]>`
        select status, rejection_reason, published_at from posts where id = ${postId}
      `;
      expect(row?.status).toBe("rejected");
      expect(row?.rejection_reason).toBe("not what this feed is for");
      expect(row?.published_at).toBeNull();
    });
  });

  /**
   * Two moderators on the same row. Without `status = 'pending'` in the update
   * both would be told theirs was the decision, and `audit_log` would hold two
   * entries that disagree about what happened.
   */
  it("lets exactly one moderator decide a post", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const { jobId } = await seedJob(tx, { accountId, userId });
      const shared = await new PostgresCommunitySubmissions(tx).share({ userId, jobId, promptVisible: true });
      const postId = shared.outcome === "shared" ? shared.post.id : "";
      const moderation = new PostgresCommunityModeration(tx);

      expect(await moderation.decide(postId, "approve")).not.toBeNull();
      expect(await moderation.decide(postId, "reject", "changed my mind")).toBeNull();

      const [row] = await tx<{ status: string }[]>`select status from posts where id = ${postId}`;
      expect(row?.status).toBe("approved");
    });
  });
});
