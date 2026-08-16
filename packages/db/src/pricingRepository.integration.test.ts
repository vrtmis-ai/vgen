import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPricingRepository, PriceUnavailableError } from "./pricingRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const HOUR = 60 * 60 * 1000;

async function seedModel(tx: Sql): Promise<{ providerModelId: string; featureId: string }> {
  const [provider] = await tx<{ id: string }[]>`
    insert into providers (code, name) values ('price-test', 'Price Test') returning id
  `;
  const [model] = await tx<{ id: string }[]>`
    insert into provider_models (provider_id, external_model_id, name, modality, family)
    values (${provider!.id}, 'test/model', 'Test Model', 'video', 'test-family')
    returning id
  `;
  const [feature] = await tx<{ id: string }[]>`select id from features where code = 'video_generate'`;
  return { providerModelId: model!.id, featureId: feature!.id };
}

interface PriceOverrides {
  selector?: Record<string, string>;
  microBase?: number;
  microPerSecond?: number;
  unitsBase?: number;
  unitsPerSecond?: number;
  maxBillable?: number | null;
  offered?: boolean;
  validFrom?: Date;
  validTo?: Date | null;
}

async function seedPrice(tx: Sql, ids: { providerModelId: string; featureId: string }, overrides: PriceOverrides = {}) {
  const [row] = await tx<{ id: string }[]>`
    insert into model_prices (
      provider_model_id, feature_id, selector, pricing_mode, is_offered,
      provider_units_base, provider_units_per_second,
      micro_credits_base, micro_credits_per_second,
      margin_pct, max_billable_units, valid_from, valid_to
    ) values (
      ${ids.providerModelId}, ${ids.featureId}, ${tx.json(overrides.selector ?? {})},
      ${overrides.microPerSecond ? "derived" : "fixed"}, ${overrides.offered ?? true},
      ${overrides.unitsBase ?? 0}, ${overrides.unitsPerSecond ?? 0},
      ${overrides.microBase ?? 0}, ${overrides.microPerSecond ?? 0},
      100, ${overrides.maxBillable ?? null},
      ${overrides.validFrom ?? new Date(Date.now() - HOUR)}, ${overrides.validTo ?? null}
    ) returning id
  `;
  return row!.id;
}

describe("resolving a price", () => {
  it("charges the row in force, in whole coins", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { microBase: 2_400_000, unitsBase: 12 });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} });

      // 2.4 coins' worth rounds up to 3, and the stored amount is 3 whole coins
      // — the customer is never charged a number no screen showed them.
      expect(price.coins).toBe(3);
      expect(price.microCredits).toBe(3_000_000);
      expect(price.providerUnits).toBe(12);
    });
  });

  it("names the row it used, so a charge can always be explained", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      const id = await seedPrice(tx, ids, { microBase: 1_000_000 });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} });

      expect(price.priceId).toBe(id);
    });
  });
});

describe("effective dating", () => {
  // The reason model_prices has valid_from and valid_to at all: a price that
  // changes must not rewrite what a job was already charged.
  it("never returns a superseded price", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, {
        microBase: 1_000_000,
        validFrom: new Date(Date.now() - 3 * HOUR),
        validTo: new Date(Date.now() - HOUR),
      });
      const current = await seedPrice(tx, ids, { microBase: 5_000_000, validFrom: new Date(Date.now() - HOUR) });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} });

      expect(price.priceId).toBe(current);
      expect(price.coins).toBe(5);
    });
  });

  it("does not start charging a future price early", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      const today = await seedPrice(tx, ids, { microBase: 1_000_000 });
      await seedPrice(tx, ids, { microBase: 9_000_000, selector: { tier: "later" }, validFrom: new Date(Date.now() + HOUR) });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} });

      expect(price.priceId).toBe(today);
    });
  });

  it("re-prices a job as of when it ran, not as of now", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      const old = await seedPrice(tx, ids, {
        microBase: 1_000_000,
        validFrom: new Date(Date.now() - 3 * HOUR),
        validTo: new Date(Date.now() - HOUR),
      });
      await seedPrice(tx, ids, { microBase: 5_000_000, validFrom: new Date(Date.now() - HOUR) });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {}, at: new Date(Date.now() - 2 * HOUR) });

      expect(price.priceId).toBe(old);
      expect(price.coins).toBe(1);
    });
  });

  it("refuses when nothing is in force", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);

      await expect(new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} })).rejects.toMatchObject({
        code: "no_price",
      });
    });
  });
});

describe("choosing a row", () => {
  it("prefers the row whose selector says more", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { microBase: 2_000_000 });
      const specific = await seedPrice(tx, ids, { selector: { resolution: "4k" }, microBase: 20_000_000 });

      const repository = new PostgresPricingRepository(tx);

      expect((await repository.priceFor({ ...ids, params: { resolution: "4k" } })).priceId).toBe(specific);
      expect((await repository.priceFor({ ...ids, params: { resolution: "720p" } })).coins).toBe(2);
    });
  });

  it("tells a combination that is not sold apart from one that has no price", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { selector: { resolution: "1080P", duration: "10" }, offered: false });
      await seedPrice(tx, ids, { selector: { resolution: "1080P", duration: "6" }, microBase: 16_000_000 });

      const repository = new PostgresPricingRepository(tx);

      // Two different answers, because the UI does two different things with
      // them: one disables the button, the other is a bug worth shouting about.
      const notSold = await repository.priceFor({ ...ids, params: { resolution: "1080P", duration: "10" } }).catch((e) => e);
      expect(notSold).toBeInstanceOf(PriceUnavailableError);
      expect(notSold.code).toBe("not_offered");

      const noRow = await repository.priceFor({ ...ids, params: { resolution: "4K", duration: "6" } }).catch((e) => e);
      expect(noRow.code).toBe("no_price");
    });
  });
});

describe("per-second pricing", () => {
  it("multiplies by the seconds supplied", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { microPerSecond: 8_200_000, unitsPerSecond: 41 });

      const price = await new PostgresPricingRepository(tx).priceFor({ ...ids, params: {}, seconds: 5 });

      expect(price.coins).toBe(41);
      expect(price.providerUnits).toBe(205);
    });
  });

  it("stops charging at the cap, where the provider stops rendering", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { microPerSecond: 4_000_000, unitsPerSecond: 20, maxBillable: 10 });

      const repository = new PostgresPricingRepository(tx);
      const capped = await repository.priceFor({ ...ids, params: {}, seconds: 45 });

      // A 45 second clip on a 10 second cap costs the same as a 10 second one:
      // the rest is uploaded and discarded, and must not be billed.
      expect(capped.coins).toBe(40);
      expect((await repository.priceFor({ ...ids, params: {}, seconds: 10 })).coins).toBe(40);
    });
  });

  it("refuses rather than guessing when no duration is given", async () => {
    await inRollback(sql, async (tx) => {
      const ids = await seedModel(tx);
      await seedPrice(tx, ids, { microPerSecond: 8_200_000, unitsPerSecond: 41 });

      // Defaulting to one second would sell a ten second video for a tenth of
      // its price, which is the expensive direction to be wrong in.
      await expect(new PostgresPricingRepository(tx).priceFor({ ...ids, params: {} })).rejects.toMatchObject({
        code: "no_price",
      });
    });
  });
});
