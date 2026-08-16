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
    params: Record<string, string>;
  }

  /** The catalogue variant the seeded grants actually point at. */
  async function grantedVariant(tx: Sql): Promise<Granted | null> {
    const [row] = await tx<
      { variant_id: string; min_tier: number; model_min_tier: number; daily_cap: number | null; selector: Record<string, string> }[]
    >`
      select model.capabilities -> 'variant' ->> 'id' as variant_id,
             ent.min_tier,
             (model.capabilities -> 'family' ->> 'minTier')::int as model_min_tier,
             ent.daily_cap,
             price.selector
      from unlimited_entitlements ent
      join provider_models model on model.id = ent.catalog_model_id
      join model_prices price on price.provider_model_id = model.id
      where ent.is_active and price.is_offered and price.valid_to is null
      limit 1
    `;
    return row
      ? {
          variantId: row.variant_id,
          minTier: row.min_tier,
          modelMinTier: row.model_min_tier,
          dailyCap: row.daily_cap,
          params: row.selector,
        }
      : null;
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
   * An account below the grant's tier never generates for free — it either
   * pays, or cannot reach the model at all.
   *
   * Which of the two depends on configuration rather than on code: today the
   * grant's min_tier (2) equals Nano Banana's own minTier (2), so tier 1 is
   * locked out of the model entirely and there is no paying customer for it.
   * Setting the grant to tier 3 would produce a paid quote here instead. The
   * assertion is written to hold either way, because what must never happen —
   * a free generation for an account the grant does not cover — is the same in
   * both worlds.
   */
  it("never gives a free quote to an account below the grant's tier", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      if (!granted || granted.minTier <= 1) return;
      const { userId } = await makeUser(tx);

      const result = await new PostgresQuotesRepository(tx).create({
        userId,
        variantId: granted.variantId,
        params: granted.params,
      });

      if (granted.modelMinTier > 1) {
        expect(result.outcome).toBe("tier_too_low");
        return;
      }
      expect(result.outcome).toBe("quoted");
      if (result.outcome !== "quoted") return;
      expect(result.quote.coins).toBeGreaterThan(0);
      expect(result.quote.unlimited).toBeUndefined();
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
});
