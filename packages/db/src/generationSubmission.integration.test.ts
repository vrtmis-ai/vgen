import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGalleryRepository } from "./galleryRepository";
import { PostgresGenerationRepository } from "./generationRepository";
import { PostgresQuotesRepository } from "./quotesRepository";
import { connect, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * Submission, end to end against the seeded catalogue.
 *
 * These go through `PostgresQuotesRepository` to get a quote rather than
 * inserting one, because the pair is the unit that matters: a quote the
 * submission path would reject is a bug either way, and half of the refusals
 * here are about the relationship between the two calls rather than about
 * either one alone.
 */

async function subscribe(tx: Sql, accountId: string, tier: number, concurrency = 8): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, max_concurrent_jobs)
    values (${`job-plan-${suffix}`}, 'Job Test Plan', ${tier}, 1000000, 10, ${concurrency})
    returning id
  `;
  await tx`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;
}

/**
 * Coins the account can actually spend. Without a lot, every paid job is 402.
 *
 * Through `grant_credits` rather than by inserting a lot: the lot, the ledger
 * entry and the balance cache are one unit, and hand-inserting only the lot
 * leaves the cache at zero — which `hold_credits` then drives negative into a
 * CHECK violation. Using the function is also the only version of "funded"
 * that matches how an account is ever actually funded.
 */
async function fund(tx: Sql, accountId: string, coins: number): Promise<void> {
  if (coins <= 0) return; // grant_credits rejects non-positive amounts
  await tx`select grant_credits(${accountId}, 'purchase', ${coins * COIN})`;
}

/** A paid variant the seeded catalogue has, with settings that price. */
async function paidVariant(tx: Sql): Promise<{ variantId: string; params: Record<string, string> }> {
  const [row] = await tx<{ variant_id: string; selector: Record<string, string> }[]>`
    select model.capabilities -> 'variant' ->> 'id' as variant_id, price.selector
    from provider_models model
    join model_prices price on price.provider_model_id = model.id
    where model.capabilities ? 'variant'
      and (model.capabilities -> 'family' ->> 'minTier')::int = 1
      and model.is_active and price.is_offered and price.valid_to is null
      and not exists (select 1 from unlimited_entitlements e where e.catalog_model_id = model.id and e.is_active)
    limit 1
  `;
  if (!row?.variant_id) throw new Error("the seeded catalogue has no priced tier-1 variant");
  return { variantId: row.variant_id, params: row.selector };
}

let keyCounter = 0;
const nextKey = () => `test-key-${Date.now()}-${keyCounter++}`;

/** A funded, subscribed account holding a live quote for a paid generation. */
async function quoted(tx: Sql, options: { coins?: number; concurrency?: number } = {}) {
  const { userId, accountId } = await makeUser(tx);
  await subscribe(tx, accountId, 3, options.concurrency ?? 8);
  await fund(tx, accountId, options.coins ?? 500);
  const { variantId, params } = await paidVariant(tx);

  const quote = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });
  if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
  return { userId, accountId, params, quote: quote.quote };
}

describe("turning a quote into a job", () => {
  it("creates a queued job, holds the coins, and announces it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId, params, quote } = await quoted(tx);
      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });

      expect(result.outcome).toBe("created");
      if (result.outcome !== "created") return;
      expect(result.job.status).toBe("queued");
      expect(result.job.quotedCredits).toBe(quote.coins);

      // The hold is the whole point: coins reserved, not yet charged.
      const [hold] = await tx<{ micro_credits: string; status: string }[]>`
        select micro_credits, status from credit_holds where ref_type = 'job' and ref_id = ${result.job.id}
      `;
      expect(hold?.status).toBe("held");
      expect(Number(hold?.micro_credits)).toBe(quote.coins * COIN);

      // Same transaction as the job — a job nothing was told about never runs.
      const [event] = await tx<{ payload: { jobId: string } }[]>`
        select payload from outbox where topic = 'generation.requested' and payload ->> 'jobId' = ${result.job.id}
      `;
      expect(event?.payload.jobId).toBe(result.job.id);

      // Held coins come out of the lot, so they cannot be spent twice.
      const [lot] = await tx<{ micro_credits_remaining: string }[]>`
        select micro_credits_remaining from credit_lots where account_id = ${accountId}
      `;
      expect(Number(lot?.micro_credits_remaining)).toBe(500 * COIN - quote.coins * COIN);
    });
  });

  it("replays the original job for a repeated idempotency key", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const repo = new PostgresGenerationRepository(tx);
      const key = nextKey();

      const first = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: key });
      const second = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: key });

      expect(first.outcome).toBe("created");
      expect(second.outcome).toBe("replayed");
      if (first.outcome === "created" && second.outcome === "replayed") {
        expect(second.job.id).toBe(first.job.id);
      }

      // The point of replaying rather than creating: one hold, one charge.
      const [countRow] = await tx<{ count: string }[]>`
        select count(*)::text as count from credit_holds where account_id = (
          select account_id from jobs where id = ${first.outcome === "created" ? first.job.id : ""}
        )
      `;
      expect(Number(countRow!.count)).toBe(1);
    });
  });

  it("refuses a second job against the same quote", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const repo = new PostgresGenerationRepository(tx);

      await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: nextKey() });
      const second = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: nextKey() });
      expect(second.outcome).toBe("quote_spent");
    });
  });

  // The reason the quote carries a hash at all.
  it("refuses settings that are not the ones quoted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params: { ...params, resolution: "4K", sneaky: "yes" },
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("params_mismatch");
    });
  });

  it("refuses an expired quote", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      await tx`update quotes set expires_at = now() - interval '1 minute' where id = ${quote.id}`;
      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("quote_expired");
    });
  });

  // Reported as missing rather than forbidden: a 403 would confirm it exists.
  it("refuses another account's quote as if it did not exist", async () => {
    await inRollback(sql, async (tx) => {
      const { params, quote } = await quoted(tx);
      const stranger = await makeUser(tx);
      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId: stranger.userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("quote_unavailable");
    });
  });

  it("refuses when the account cannot pay, and leaves nothing behind", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId, params, quote } = await quoted(tx, { coins: 0 });
      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("insufficient_credits");

      // The assertion that matters more than the outcome: a failure anywhere
      // must leave no job, no hold and no queued event.
      const [jobsRow] = await tx<{ jobs: string }[]>`select count(*)::text as jobs from jobs where account_id = ${accountId}`;
      const [holdsRow] = await tx<{ holds: string }[]>`select count(*)::text as holds from credit_holds where account_id = ${accountId}`;
      expect(Number(jobsRow!.jobs)).toBe(0);
      expect(Number(holdsRow!.holds)).toBe(0);
    });
  });

  it("refuses once the account is at its plan's concurrency limit", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId, params, quote } = await quoted(tx, { concurrency: 1 });
      const repo = new PostgresGenerationRepository(tx);

      // One already in flight fills a limit of one.
      const [feature] = await tx<{ id: string }[]>`select id from features limit 1`;
      await tx`
        insert into jobs (account_id, created_by, feature_id, status)
        values (${accountId}, ${userId}, ${feature!.id}, 'running')
      `;

      const result = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: nextKey() });
      expect(result.outcome).toBe("concurrency_reached");
    });
  });

  it("refuses a key reused for a different quote", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const { variantId, params: freshParams } = await paidVariant(tx);
      const second = await new PostgresQuotesRepository(tx).create({ userId, variantId, params: freshParams });
      if (second.outcome !== "quoted") throw new Error("expected a second quote");

      const repo = new PostgresGenerationRepository(tx);
      const key = nextKey();
      await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: key });
      const clash = await repo.createQueued({
        userId,
        quoteId: second.quote.id,
        params: freshParams,
        idempotencyKey: key,
      });
      expect(clash.outcome).toBe("idempotency_conflict");
    });
  });
});

describe("submitting a generation covered by a grant", () => {
  /** An account on a plan that reaches the seeded grant, holding a free quote. */
  async function grantQuoted(tx: Sql) {
    const [grant] = await tx<{ variant_id: string; min_tier: number; selector: Record<string, string> }[]>`
      select model.capabilities -> 'variant' ->> 'id' as variant_id, ent.min_tier, price.selector
      from unlimited_entitlements ent
      join provider_models model on model.id = ent.catalog_model_id
      join model_prices price on price.provider_model_id = model.id
      where ent.is_active and price.is_offered and price.valid_to is null
      limit 1
    `;
    if (!grant) return null;

    const { userId, accountId } = await makeUser(tx);
    await subscribe(tx, accountId, grant.min_tier);
    const quote = await new PostgresQuotesRepository(tx).create({
      userId,
      variantId: grant.variant_id,
      params: grant.selector,
    });
    if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
    return { userId, accountId, params: grant.selector, quote: quote.quote };
  }

  // The two caveats this phase existed to close: the allowance now moves.
  it("spends one of the day's allowance and holds no coins", async () => {
    await inRollback(sql, async (tx) => {
      const seeded = await grantQuoted(tx);
      if (!seeded) return;
      const { userId, accountId, params, quote } = seeded;
      expect(quote.coins).toBe(0);

      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("created");
      if (result.outcome !== "created") return;

      const [usage] = await tx<{ used: number }[]>`
        select used from unlimited_usage where account_id = ${accountId}
      `;
      expect(usage?.used).toBe(1);

      // Free means free: no hold, nothing to capture, nothing to release.
      const [holdsRow] = await tx<{ holds: string }[]>`select count(*)::text as holds from credit_holds where account_id = ${accountId}`;
      expect(Number(holdsRow!.holds)).toBe(0);
      expect(result.job.quotedCredits).toBe(0);
    });
  });

  it("refuses when the allowance ran out between quoting and submitting", async () => {
    await inRollback(sql, async (tx) => {
      const seeded = await grantQuoted(tx);
      if (!seeded) return;
      const { userId, accountId, params, quote } = seeded;

      // Quoted free, then the day is spent before the button is pressed.
      await tx`
        insert into unlimited_usage (entitlement_id, account_id, usage_date, used)
        select ent.id, ${accountId}, (now() at time zone 'Asia/Tehran')::date, ent.daily_cap
        from unlimited_entitlements ent
        where ent.id = (select entitlement_id from quotes where id = ${quote.id})
      `;

      const result = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      expect(result.outcome).toBe("allowance_spent");

      // And the refusal took nothing with it.
      const [jobsRow] = await tx<{ jobs: string }[]>`select count(*)::text as jobs from jobs where account_id = ${accountId}`;
      expect(Number(jobsRow!.jobs)).toBe(0);
    });
  });
});

describe("reading a job back", () => {
  it("gives an owner their job", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const repo = new PostgresGenerationRepository(tx);
      const created = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: nextKey() });
      if (created.outcome !== "created") throw new Error("expected a job");

      // Read back through the gallery repository, which is now the only way a
      // job is read: one query serves this, `GET /generation/jobs/:id` and a
      // page of the gallery, so all three necessarily agree.
      const read = await new PostgresGalleryRepository(tx).getForUser(created.job.id, userId);
      expect(read?.id).toBe(created.job.id);
      expect(read?.variantId).toBe(created.job.modelKey);
      expect(read?.status).toBe("queued");
    });
  });

  // A job id is not a capability.
  it("hides it from anybody else", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const stranger = await makeUser(tx);
      const repo = new PostgresGenerationRepository(tx);
      const created = await repo.createQueued({ userId, quoteId: quote.id, params, idempotencyKey: nextKey() });
      if (created.outcome !== "created") throw new Error("expected a job");

      expect(await new PostgresGalleryRepository(tx).getForUser(created.job.id, stranger.userId)).toBeNull();
    });
  });
});

/**
 * References travel quote -> job, never request -> job.
 *
 * The params hash is what stops a cheap quote being spent on an expensive job,
 * and the references sit outside it. Taking them from the submission request
 * would reopen exactly that hole one field to the left: quote with no
 * attachments, submit with somebody's face.
 */
describe("submitting a job that carries reference uploads", () => {
  async function uploadFor(tx: Sql, accountId: string, userId: string): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      insert into assets (
        account_id, created_by, kind, origin, storage_provider, storage_bucket, storage_key,
        mime_type, byte_size, sha256, moderation_state, visibility
      ) values (
        ${accountId}, ${userId}, 'image', 'upload', 's3', 'vgen', ${`uploads/${accountId}/ref.png`},
        'image/png', 2048, ${`sha-${accountId}`}, 'pending', 'private'
      )
      returning id
    `;
    return row!.id;
  }

  it("copies the quote's references onto the job", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      await fund(tx, accountId, 500);
      const { variantId, params } = await paidVariant(tx);
      const assetId = await uploadFor(tx, accountId, userId);

      const quote = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [assetId] },
      });
      if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);

      const created = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      if (created.outcome !== "created") throw new Error(`expected a job, got ${created.outcome}`);

      const [row] = await tx<{ reference_asset_ids: Record<string, string[]> | null }[]>`
        select reference_asset_ids from jobs where id = ${created.job.id}
      `;
      // Its own copy, not a read through the quote: 0023 deletes expired
      // quotes on a schedule and "which files went into this picture" outlives
      // the five minutes a quote lives.
      expect(row!.reference_asset_ids).toEqual({ image_urls: [assetId] });
    });
  });

  it("leaves the column null for a job with no attachments", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      await fund(tx, accountId, 500);
      const { variantId, params } = await paidVariant(tx);

      const quote = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });
      if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
      const created = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.quote.id,
        params,
        idempotencyKey: nextKey(),
      });
      if (created.outcome !== "created") throw new Error(`expected a job, got ${created.outcome}`);

      const [row] = await tx<{ reference_asset_ids: Record<string, string[]> | null }[]>`
        select reference_asset_ids from jobs where id = ${created.job.id}
      `;
      // Null rather than `{}`: nothing was attached, which is a different fact
      // from an empty attachment map and reads that way in the database.
      expect(row!.reference_asset_ids).toBeNull();
    });
  });
});
