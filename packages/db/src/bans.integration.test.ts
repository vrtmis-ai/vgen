import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresBansRepository, isBannedFromGenerating, isBannedFromPublishing } from "./bansRepository";
import { PostgresGenerationRepository } from "./generationRepository";
import { PostgresQuotesRepository } from "./quotesRepository";
import { COIN, connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * What a ban actually stops.
 *
 * The `bans` table has existed since migration 0001 and, until this change,
 * appeared nowhere else in the codebase — nothing wrote a row and nothing read
 * one. That made a ban button the most dangerous thing the admin panel could
 * grow: staff would mark an account banned, the panel would list it as banned,
 * and the account would keep generating. These tests exist so that cannot
 * silently become true again.
 *
 * The refusal is asserted through `createQueued`, not through the predicate,
 * because the predicate being right is not the claim worth making. The claim is
 * that a banned account cannot get a job into the queue.
 */

async function subscribe(tx: Sql, accountId: string): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, max_concurrent_jobs)
    values (${`ban-plan-${suffix}`}, 'Ban Test Plan', 3, 1000000, 10, 8)
    returning id
  `;
  await tx`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;
}

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
const nextKey = () => `ban-key-${Date.now()}-${keyCounter++}`;

/** A funded, subscribed account holding a live quote for a paid generation. */
async function quoted(tx: Sql) {
  const { userId, accountId } = await makeUser(tx);
  await subscribe(tx, accountId);
  await tx`select grant_credits(${accountId}, 'purchase', ${500 * COIN})`;
  const { variantId, params } = await paidVariant(tx);

  const quote = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });
  if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
  return { userId, accountId, params, quote: quote.quote };
}

const submit = (tx: Sql, userId: string, quoteId: string, params: Record<string, string>) =>
  new PostgresGenerationRepository(tx).createQueued({ userId, quoteId, params, idempotencyKey: nextKey() });

describe("a ban on generating", () => {
  it("refuses the job and holds none of the account's coins", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId, params, quote } = await quoted(tx);
      await new PostgresBansRepository(tx).create({ userId, scope: "generation", reason: "chargebacks", createdBy: userId });

      const result = await submit(tx, userId, quote.id, params);

      expect(result.outcome).toBe("banned");
      // Refused before anything is reserved. A ban that still took the coins
      // out of the lot would be a refund waiting to be argued about.
      const [held] = await tx<{ count: string }[]>`
        select count(*) as count from credit_holds where account_id = ${accountId}
      `;
      expect(Number(held!.count)).toBe(0);
      const [lot] = await tx<{ micro_credits_remaining: string }[]>`
        select micro_credits_remaining from credit_lots where account_id = ${accountId}
      `;
      expect(Number(lot!.micro_credits_remaining)).toBe(500 * COIN);
    });
  });

  it("refuses a platform ban too, since that is the wider one", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      await new PostgresBansRepository(tx).create({ userId, scope: "platform", createdBy: userId });

      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("banned");
    });
  });

  it("lets a comments-only ban through — it is about publishing, not spending", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      await new PostgresBansRepository(tx).create({ userId, scope: "comments", createdBy: userId });

      // Scopes are separate on purpose. Silencing someone in the comments is
      // not the same decision as stopping them using what they paid for.
      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("created");
    });
  });

  it("stops counting once the ban expires", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      await tx`
        insert into bans (user_id, scope, expires_at)
        values (${userId}, 'generation', now() - interval '1 hour')
      `;

      expect(await isBannedFromGenerating(tx, userId)).toBe(false);
      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("created");
    });
  });

  it("stops counting once it is lifted, and keeps the row", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const bans = new PostgresBansRepository(tx);
      const ban = await bans.create({ userId, scope: "generation", createdBy: userId });

      expect(await bans.lift(ban.id)).toBe(true);
      expect(await bans.listActive(userId)).toHaveLength(0);
      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("created");

      // Stamped, not deleted. "Was this account ever banned, and who undid it"
      // is a question a dispute turns on, and a DELETE answers it with silence.
      const [row] = await tx<{ lifted_at: Date | null }[]>`select lifted_at from bans where id = ${ban.id}`;
      expect(row!.lifted_at).not.toBeNull();
      // Lifting twice is not an error, but it is not a second lift either.
      expect(await bans.lift(ban.id)).toBe(false);
    });
  });

  it("cannot be retried around with a fresh idempotency key", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      await new PostgresBansRepository(tx).create({ userId, scope: "generation", createdBy: userId });

      // The check sits before the replay lookup, so neither a new key nor a
      // repeated one is a way in.
      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("banned");
      expect((await submit(tx, userId, quote.id, params)).outcome).toBe("banned");
    });
  });

  it("does not touch a job that was already queued before the ban", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, params, quote } = await quoted(tx);
      const created = await submit(tx, userId, quote.id, params);
      expect(created.outcome).toBe("created");

      await new PostgresBansRepository(tx).create({ userId, scope: "platform", createdBy: userId });

      // A ban stops new work. Killing generations already paid for and running
      // is a separate decision nobody has asked for, and doing it here would
      // owe a refund this code does not issue.
      if (created.outcome !== "created") return;
      const [job] = await tx<{ status: string }[]>`select status from jobs where id = ${created.job.id}`;
      expect(job!.status).toBe("queued");
    });
  });
});

describe("the publishing scopes", () => {
  it("counts explore and platform, and not generation", async () => {
    await inRollback(sql, async (tx) => {
      const explore = await makeUser(tx);
      const platform = await makeUser(tx);
      const generation = await makeUser(tx);
      const bans = new PostgresBansRepository(tx);
      await bans.create({ userId: explore.userId, scope: "explore", createdBy: explore.userId });
      await bans.create({ userId: platform.userId, scope: "platform", createdBy: platform.userId });
      await bans.create({ userId: generation.userId, scope: "generation", createdBy: generation.userId });

      expect(await isBannedFromPublishing(tx, explore.userId)).toBe(true);
      expect(await isBannedFromPublishing(tx, platform.userId)).toBe(true);
      // Barred from spending, still allowed to publish what they already made.
      expect(await isBannedFromPublishing(tx, generation.userId)).toBe(false);
    });
  });

  it("is not called by anything yet, because there is nowhere to publish", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      // `GET /api/v1/community` is read-only and the seeded posts came from
      // `scripts/publish-community.ts`. This predicate is correct and unused
      // until a POST exists — which is a different thing from a ban that does
      // not work, and is written down here so it stays a known gap.
      expect(await isBannedFromPublishing(tx, userId)).toBe(false);
    });
  });
});
