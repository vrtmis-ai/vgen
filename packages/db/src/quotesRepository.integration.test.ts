import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresQuotesRepository } from "./quotesRepository";
import { connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * These run against the seeded catalogue, pricing and grants rather than
 * against fixtures.
 *
 * That is the point: the paid path, the tier gate and the unlimited path are
 * all configuration, and a test built from its own fixtures would prove the
 * code works on data that does not exist. What is asserted is the shape of the
 * answer — free versus priced, allowed versus locked — never a specific coin
 * count, because `pricing.expected.json` already freezes all 738 of those and
 * repeating one here would only mean two places to edit when a price moves.
 */

/** Puts an account on a plan of the given tier, the way a purchase would. */
async function subscribe(tx: Sql, accountId: string, tier: number): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount)
    values (${`quote-plan-${suffix}`}, 'Quote Test Plan', ${tier}, 1000000, 10)
    returning id
  `;
  await tx`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;
}

/**
 * A variant at the given minimum tier, together with settings that price.
 *
 * The params come from one of the variant's own live price rows rather than
 * being written here. Prices are keyed on a selector — resolution, mode,
 * duration — and an invented parameter set matches no row, so a hand-written
 * `{}` would make these tests fail on "no price" for reasons that have nothing
 * to do with what they are checking.
 */
async function variantAtTier(tx: Sql, minTier: number): Promise<{ variantId: string; params: Record<string, string> }> {
  const [row] = await tx<{ variant_id: string; selector: Record<string, string> }[]>`
    select model.capabilities -> 'variant' ->> 'id' as variant_id, price.selector
    from provider_models model
    join model_prices price on price.provider_model_id = model.id
    where model.capabilities ? 'variant'
      and (model.capabilities -> 'family' ->> 'minTier')::int = ${minTier}
      and model.is_active
      and price.is_offered
      and price.valid_to is null
    limit 1
  `;
  if (!row?.variant_id) throw new Error(`the seeded catalogue has no priced tier-${minTier} variant; run pnpm catalog:publish`);
  return { variantId: row.variant_id, params: row.selector };
}

describe("quoting a generation", () => {
  it("refuses a variant that does not exist", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: "no-such-model",
        params: {},
      });
      expect(result.outcome).toBe("unknown_variant");
    });
  });

  it("prices a tier-1 model for an account with no plan", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const { variantId, params } = await variantAtTier(tx, 1);
      const result = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();
      expect(result.quote.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  // The assertion this whole phase exists for. Before it, a free account could
  // curl its way onto a flagship model and the only thing stopping it was a
  // padlock drawn in the browser.
  it("locks a tier-3 model against an account with no plan", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const { variantId, params } = await variantAtTier(tx, 3);
      const result = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });

      expect(result.outcome).toBe("tier_too_low");
      if (result.outcome !== "tier_too_low") return;
      expect(result.requiredTier).toBe(3);
      expect(result.currentTier).toBe(1);
    });
  });

  it("opens that same model once the account is on a plan that reaches it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 3);
      const result = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });

      expect(result.outcome).toBe("quoted");
    });
  });

  it("writes a params hash so a cheap quote cannot be spent on an expensive job", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const { variantId, params } = await variantAtTier(tx, 1);
      const repo = new PostgresQuotesRepository(tx);

      const first = await repo.create({ userId, variantId, params });
      const second = await repo.create({ userId, variantId, params: { ...params } });
      // Same settings, one extra key: a different request, so a different hash.
      const third = await repo.create({ userId, variantId, params: { ...params, seed: "42" } });
      if (first.outcome !== "quoted" || second.outcome !== "quoted" || third.outcome !== "quoted") {
        throw new Error("expected three quotes");
      }

      const hashes = await tx<{ id: string; params_hash: Buffer }[]>`
        select id, params_hash from quotes
        where id in (${first.quote.id}, ${second.quote.id}, ${third.quote.id})
      `;
      const by = new Map(hashes.map((row) => [row.id, row.params_hash.toString("hex")]));
      expect(by.get(first.quote.id)).toBe(by.get(second.quote.id));
      expect(by.get(first.quote.id)).not.toBe(by.get(third.quote.id));
    });
  });

  it("records the rate the customer was shown", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const { variantId, params } = await variantAtTier(tx, 1);
      const result = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });
      if (result.outcome !== "quoted") throw new Error("expected a quote");

      const [row] = await tx<{ exchange_rate_irr_per_usd: string }[]>`
        select exchange_rate_irr_per_usd from quotes where id = ${result.quote.id}
      `;
      expect(Number(row!.exchange_rate_irr_per_usd)).toBeGreaterThan(0);
    });
  });
});

describe("quoting a model covered by an unlimited grant", () => {
  interface Granted {
    variantId: string;
    minTier: number;
    modelMinTier: number;
    dailyCap: number | null;
    /** A priced setting the grant *does* cover. */
    params: Record<string, string>;
    covers: Record<string, string[]> | null;
  }

  /**
   * The catalogue variant the seeded grants actually point at, with a setting
   * the grant covers.
   *
   * The `covers` filter is not decoration. Nano Banana prices 1K, 2K and 4K,
   * and the seeded grant covers only the first two — so an unfiltered `limit 1`
   * picks a free-looking row or a paid one depending on what Postgres feels
   * like returning, and the zero-price test below passes or fails at random.
   * It genuinely did pick a covered row on the first run; that is luck, not a
   * result. Ordering makes it repeatable and the filter makes it correct.
   */
  async function grantedVariant(tx: Sql): Promise<Granted | null> {
    const [row] = await tx<
      {
        variant_id: string;
        min_tier: number;
        model_min_tier: number;
        daily_cap: number | null;
        selector: Record<string, string>;
        covers: Record<string, string[]> | null;
      }[]
    >`
      select model.capabilities -> 'variant' ->> 'id' as variant_id,
             ent.min_tier,
             (model.capabilities -> 'family' ->> 'minTier')::int as model_min_tier,
             ent.daily_cap,
             price.selector,
             ent.covers
      from unlimited_entitlements ent
      join provider_models model on model.id = ent.catalog_model_id
      join model_prices price on price.provider_model_id = model.id
      where ent.is_active and price.is_offered and price.valid_to is null
        -- every key the grant narrows must be satisfied by this price's selector
        and (
          ent.covers is null
          or not exists (
            select 1 from jsonb_each(ent.covers) as cover(key, allowed)
            where not (cover.allowed ? coalesce(price.selector ->> cover.key, ''))
          )
        )
      order by variant_id, price.selector::text
      limit 1
    `;
    return row
      ? {
          variantId: row.variant_id,
          minTier: row.min_tier,
          modelMinTier: row.model_min_tier,
          dailyCap: row.daily_cap,
          params: row.selector,
          covers: row.covers,
        }
      : null;
  }

  /** A priced setting for a granted variant that the grant does *not* cover. */
  async function uncoveredSetting(tx: Sql): Promise<{ variantId: string; minTier: number; params: Record<string, string> } | null> {
    const [row] = await tx<{ variant_id: string; min_tier: number; selector: Record<string, string> }[]>`
      select model.capabilities -> 'variant' ->> 'id' as variant_id, ent.min_tier, price.selector
      from unlimited_entitlements ent
      join provider_models model on model.id = ent.catalog_model_id
      join model_prices price on price.provider_model_id = model.id
      where ent.is_active and price.is_offered and price.valid_to is null
        and ent.covers is not null
        and exists (
          select 1 from jsonb_each(ent.covers) as cover(key, allowed)
          where not (cover.allowed ? coalesce(price.selector ->> cover.key, ''))
        )
      order by variant_id, price.selector::text
      limit 1
    `;
    return row ? { variantId: row.variant_id, minTier: row.min_tier, params: row.selector } : null;
  }

  it("quotes it at zero for an account whose plan reaches the grant", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted) return; // no grants seeded in this database
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBe(0);
      expect(result.quote.unlimited).toEqual({ remainingToday: granted.dailyCap, dailyCap: granted.dailyCap });

      // Free because of a grant, not because of a zero price — and the row
      // says which, so "why did we not charge for this" stays answerable.
      const [row] = await tx<{ price_id: string | null; entitlement_id: string | null }[]>`
        select price_id, entitlement_id from quotes where id = ${result.quote.id}
      `;
      expect(row!.price_id).toBeNull();
      expect(row!.entitlement_id).not.toBeNull();
    });
  });

  /**
   * The gap between the two tiers is where the money is.
   *
   * The grant sits one tier above the model's own minTier on purpose: Nano
   * Banana needs tier 2, the grant needs tier 3. That leaves exactly one band —
   * tier 2 — that can reach the model and still pays for it, and that band is
   * the entire reason the grant is a reason to upgrade rather than a write-off.
   * Close the gap and nobody who can use the model ever pays for it.
   *
   * So this asserts the paying band exists and is charged. Written off the
   * seeded numbers rather than hard-coded, so it follows the configuration if
   * the tiers are ever moved — and skips rather than lies if the gap is closed.
   */
  it("charges the band that reaches the model but not the grant", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted || granted.minTier <= granted.modelMinTier) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.modelMinTier);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();
    });
  });

  /** And below the model's own tier there is nothing to buy at any price. */
  it("locks an account that cannot reach the model at all", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted || granted.modelMinTier <= 1) return;
      const { userId } = await makeUser(tx);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
      });
      expect(result.outcome).toBe("tier_too_low");
    });
  });

  // Past the daily allowance the customer is not refused, they are charged —
  // "you have had your fifty free, this one costs four coins" is a better
  // answer than a locked button, and needs no new UI to say it.
  it("falls back to the paid price once the daily allowance is gone", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted || granted.dailyCap === null) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);

      // Spend the allowance directly rather than through 50 quotes: quoting
      // does not consume, which is itself the behaviour being relied on here.
      await tx`
        insert into unlimited_usage (entitlement_id, account_id, usage_date, used)
        select ent.id, ${accountId}, (now() at time zone 'Asia/Tehran')::date, ${granted.dailyCap}
        from unlimited_entitlements ent
        join provider_models model on model.id = ent.catalog_model_id
        where model.capabilities -> 'variant' ->> 'id' = ${granted.variantId}
      `;

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();
    });
  });

  it("does not spend the allowance merely by asking the price", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);
      const repo = new PostgresQuotesRepository(tx);

      for (let i = 0; i < 3; i++) await repo.create({ userId, variantId: granted.variantId, params: granted.params });

      const [row] = await tx<{ used: number }[]>`
        select coalesce(sum(used), 0)::int as used from unlimited_usage where account_id = ${accountId}
      `;
      expect(row!.used).toBe(0);
    });
  });

  /**
   * The grant applies without being asked for, and that has to stay true.
   *
   * `preferUnlimited` is new; every client that predates it sends nothing. If
   * an absent field read as false, this quote would come back priced and the
   * customers being newly charged would be exactly the ones on the plans that
   * were sold the perk. So the default is asserted rather than assumed, in the
   * same shape a pre-switch client produces.
   */
  it("stays free when the request says nothing about the pipe", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
        // preferUnlimited deliberately absent
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBe(0);
      expect(result.quote.unlimited).toBeDefined();
    });
  });

  /**
   * Declining the grant buys the quick queue.
   *
   * The customer holds the entitlement and is choosing to pay anyway, so this
   * must produce a real price and a real `price_id` — not a zero with the
   * grant quietly still attached, which would bill nothing while the row
   * claimed a sale.
   */
  it("charges an entitled account that asks to be billed", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
        preferUnlimited: false,
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();

      const [row] = await tx<{ price_id: string | null; entitlement_id: string | null }[]>`
        select price_id, entitlement_id from quotes where id = ${result.quote.id}
      `;
      expect(row!.price_id).not.toBeNull();
      expect(row!.entitlement_id).toBeNull();
    });
  });

  /**
   * A grant is not a blank cheque over every setting.
   *
   * The subscription serves Nano Banana to 2K; 4K goes back through the metered
   * provider at the metered price. Without this the customer flips a switch
   * labelled free, picks 4K, and is charged — the failure `covers` exists to
   * prevent, and a money failure rather than a cosmetic one.
   *
   * Skips rather than lies if no grant narrows anything, so closing the gap by
   * removing the ceiling does not leave a test asserting a fiction.
   */
  it("charges for a setting the grant does not cover, even when entitled", async () => {
    await inRollback(sql, async (tx) => {
      const uncovered = await uncoveredSetting(tx);
      if (!uncovered) return;
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, uncovered.minTier);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: uncovered.variantId,
        params: uncovered.params,
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();

      const [row] = await tx<{ entitlement_id: string | null }[]>`
        select entitlement_id from quotes where id = ${result.quote.id}
      `;
      expect(row!.entitlement_id).toBeNull();
    });
  });
});

/**
 * Reference uploads, on the one path where getting authorisation wrong hands
 * one customer's private file to another customer's generation.
 *
 * An asset id is a uuid in a JSON body. It is not a capability, and the reason
 * these tests exist is that treating it as one would never show up as an error
 * — the thief never sees the bytes, they see the picture made from them.
 */
describe("quoting with reference uploads", () => {
  /** A stored file belonging to an account, at whichever origin the test needs. */
  async function asset(tx: Sql, accountId: string, userId: string, origin: string, suffix: string): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      insert into assets (
        account_id, created_by, kind, origin, storage_provider, storage_bucket, storage_key,
        mime_type, byte_size, sha256, moderation_state, visibility
      ) values (
        ${accountId}, ${userId}, 'image', ${origin}, 's3', 'vgen', ${`${origin}/${accountId}/${suffix}.png`},
        'image/png', 2048, ${`sha-${suffix}`}, 'pending', 'private'
      )
      returning id
    `;
    return row!.id;
  }

  /** The common case, kept as its own name because most tests only want this. */
  const upload = (tx: Sql, accountId: string, userId: string, suffix: string) => asset(tx, accountId, userId, "upload", suffix);

  it("prices a generation that names the account's own upload", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const assetId = await upload(tx, accountId, userId, "mine");

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [assetId] },
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;

      // Recorded on the quote, because some models price by what arrived and
      // the job is built from the quote rather than from the request.
      const [row] = await tx<{ reference_asset_ids: Record<string, string[]> | null }[]>`
        select reference_asset_ids from quotes where id = ${result.quote.id}
      `;
      expect(row!.reference_asset_ids).toEqual({ image_urls: [assetId] });
    });
  });

  /**
   * The one that matters.
   */
  it("refuses an upload belonging to somebody else", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await subscribe(tx, mine.accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const stolen = await upload(tx, theirs.accountId, theirs.userId, "theirs");

      const result = await new PostgresQuotesRepository(tx).create({
        userId: mine.userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [stolen] },
      });

      expect(result.outcome).toBe("unknown_reference");
      // And no quote row exists to be spent on a job later.
      const rows = await tx<{ id: string }[]>`select id from quotes where account_id = ${mine.accountId}`;
      expect(rows).toHaveLength(0);
    });
  });

  it("refuses an id that is not an asset at all", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: ["11111111-1111-4111-8111-111111111111"] },
      });

      expect(result.outcome).toBe("unknown_reference");
    });
  });

  it("refuses a deleted upload, because deleting one has to mean something", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const assetId = await upload(tx, accountId, userId, "gone");
      await tx`update assets set deleted_at = now() where id = ${assetId}`;

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [assetId] },
      });

      expect(result.outcome).toBe("unknown_reference");
    });
  });

  /**
   * A generated file CAN be fed back in by id, and that is the decision this
   * comment used to hold the door open for.
   *
   * It was refused before — not because it would leak, it is the caller's own
   * output, but because "use my last result as an input" is a feature that
   * should arrive deliberately rather than as a side effect of a loose
   * ownership check. "To video" on a finished image is that feature: the bytes
   * are already ours and already this account's, so making the browser download
   * and re-upload them would store a second copy to reach the same row.
   *
   * The ownership predicate is untouched; only the origin list grew, and it
   * grew by exactly one value. The test after this one pins that.
   */
  it("prices a generation that names one of the account's own generated outputs", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const generated = await asset(tx, accountId, userId, "generated", "out");

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [generated] },
      });

      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      const [row] = await tx<{ reference_asset_ids: Record<string, string[]> | null }[]>`
        select reference_asset_ids from quotes where id = ${result.quote.id}
      `;
      expect(row!.reference_asset_ids).toEqual({ image_urls: [generated] });
    });
  });

  /**
   * Two origins, not "any origin the account happens to own".
   *
   * `system` and `derived` are ours rather than the customer's — seeded
   * catalogue art, thumbnails — and nobody picked them in a slot. Widening the
   * check to admit a generated output must not have widened it to everything,
   * and only a test that names the other origins can say so.
   */
  it.each(["system", "derived"])("still refuses an asset with origin %s", async (origin) => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const other = await asset(tx, accountId, userId, origin, `other-${origin}`);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [other] },
      });

      expect(result.outcome).toBe("unknown_reference");
    });
  });

  /**
   * Ownership still decides, whatever the origin says.
   *
   * The interesting case now that a generated file is usable: somebody else's
   * generated file has to stay as refused as their upload always was.
   */
  it("refuses a generated output belonging to somebody else", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await subscribe(tx, mine.accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const stolen = await asset(tx, theirs.accountId, theirs.userId, "generated", "theirs");

      const result = await new PostgresQuotesRepository(tx).create({
        userId: mine.userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [stolen] },
      });

      expect(result.outcome).toBe("unknown_reference");
    });
  });

  /**
   * All or nothing, rather than quoting with the ids that happened to check out.
   *
   * Partial acceptance is the silent-drop bug in a new hat: the customer
   * attached two faces, one was refused, and the picture comes back made from
   * one face at the price of two.
   */
  it("refuses the whole quote when one id of several is not usable", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await subscribe(tx, mine.accountId, 3);
      const { variantId, params } = await variantAtTier(tx, 1);
      const ok = await upload(tx, mine.accountId, mine.userId, "ok");
      const stolen = await upload(tx, theirs.accountId, theirs.userId, "not-ok");

      const result = await new PostgresQuotesRepository(tx).create({
        userId: mine.userId,
        variantId,
        params,
        referenceAssetIds: { image_urls: [ok, stolen] },
      });

      expect(result.outcome).toBe("unknown_reference");
    });
  });
});
