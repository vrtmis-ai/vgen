import { describe, expect, it } from "vitest";
import {
  COIN_USD,
  KIE_CREDIT_USD,
  MARGIN,
  MICRO_CREDITS_PER_COIN,
  coinsFor,
  coinsForKieCredits,
  coinsToMicroCredits,
  microCreditsFor,
  microCreditsToCoins,
} from "./pricing";
import { isRefusal, resolvePrice, type PriceRowLike } from "./priceResolution";

/** A flat, offered row with every rate at zero — the base for the cases below. */
const FLAT: PriceRowLike = {
  selector: {},
  pricingMode: "fixed",
  isOffered: true,
  providerUnitsBase: 0,
  providerUnitsPerSecond: 0,
  providerUnitsPer1kInput: 0,
  microCreditsBase: 0,
  microCreditsPerSecond: 0,
  microCreditsPer1kInput: 0,
  maxBillableUnits: null,
};

describe("coin pricing", () => {
  it("holds the locked economics", () => {
    expect(COIN_USD).toBe(0.05);
    expect(KIE_CREDIT_USD).toBe(0.005);
    expect(MARGIN).toBe(2);
    // 1 KIE credit costs $0.005, doubled is $0.01, which is 0.2 coins.
    expect(coinsForKieCredits(5)).toBe(1);
  });

  it("always rounds a price up, never down", () => {
    // Rounding a fractional coin down is selling a generation below cost.
    expect(coinsFor(0.001)).toBe(1);
    expect(coinsFor(0.026)).toBe(2);
    expect(coinsForKieCredits(1)).toBe(1);
    expect(coinsForKieCredits(6)).toBe(2);
  });

  it("charges nothing for nothing", () => {
    expect(coinsFor(0)).toBe(0);
    expect(coinsForKieCredits(0)).toBe(0);
  });
});

describe("micro-credit conversion", () => {
  it("round-trips whole coins", () => {
    expect(coinsToMicroCredits(12)).toBe(12 * MICRO_CREDITS_PER_COIN);
    expect(microCreditsToCoins(coinsToMicroCredits(12))).toBe(12);
  });

  it("rounds a partial coin toward the customer's disadvantage when displaying", () => {
    // Half a coin cannot buy anything, so a balance must not read as if it can.
    expect(microCreditsToCoins(MICRO_CREDITS_PER_COIN - 1)).toBe(0);
    expect(microCreditsToCoins(MICRO_CREDITS_PER_COIN * 3 + 999_999)).toBe(3);
  });

  it("refuses a fractional coin rather than silently truncating it", () => {
    // A float here is a rounding error in the money path; loud beats quiet.
    expect(() => coinsToMicroCredits(1.5)).toThrow(RangeError);
  });

  it("prices to a whole coin, so the stored amount matches the quoted one", () => {
    // 3 coins, not 2.4 coins' worth of micro-credits: the customer was shown 3.
    expect(microCreditsFor(0.06)).toBe(coinsToMicroCredits(3));
    expect(microCreditsFor(0.06) % MICRO_CREDITS_PER_COIN).toBe(0);
  });
});

describe("unsellable combinations", () => {
  // A price row can say "we do not sell that", and it is not the same answer as
  // a price of zero or a missing row. Inventing a price here would open the
  // create button on a generation the provider is guaranteed to refuse.
  const rows = [
    { ...FLAT, selector: { resolution: "768P", duration: "6" }, microCreditsBase: 9_000_000, providerUnitsBase: 45 },
    { ...FLAT, selector: { resolution: "1080P", duration: "6" }, microCreditsBase: 16_000_000, providerUnitsBase: 80 },
    { ...FLAT, selector: { resolution: "1080P", duration: "10" }, isOffered: false },
  ];

  it("prices the combinations the provider offers", () => {
    expect(resolvePrice(rows, { params: { resolution: "768P", duration: "6" } })).toMatchObject({ coins: 9 });
    expect(resolvePrice(rows, { params: { resolution: "1080P", duration: "6" } })).toMatchObject({ coins: 16 });
  });

  it("refuses a combination the provider does not offer", () => {
    expect(resolvePrice(rows, { params: { resolution: "1080P", duration: "10" } })).toBe("not_offered");
  });

  it("never turns a refusal into a chargeable price", () => {
    const outcome = resolvePrice(rows, { params: { resolution: "1080P", duration: "10" } });
    expect(isRefusal(outcome)).toBe(true);
    expect(outcome).not.toBe(0);
  });

  it("says so plainly when no row covers the settings at all", () => {
    expect(resolvePrice(rows, { params: { resolution: "4K", duration: "6" } })).toBe("no_matching_row");
  });
});

describe("choosing between rows", () => {
  // A general row and a specific one both match; the specific one has to win, or
  // every 4k job is charged the base price and the margin quietly goes.
  const rows = [
    { ...FLAT, selector: {}, microCreditsBase: 2_000_000, providerUnitsBase: 10 },
    { ...FLAT, selector: { resolution: "4k" }, microCreditsBase: 20_000_000, providerUnitsBase: 100 },
  ];

  it("prefers the most specific matching row", () => {
    expect(resolvePrice(rows, { params: { resolution: "4k" } })).toMatchObject({ coins: 20 });
    expect(resolvePrice(rows, { params: { resolution: "720p" } })).toMatchObject({ coins: 2 });
  });
});

describe("quantities", () => {
  const perSecond = [{ ...FLAT, pricingMode: "derived" as const, microCreditsPerSecond: 8_200_000, providerUnitsPerSecond: 41 }];

  it("multiplies a per-second rate by the seconds supplied", () => {
    expect(resolvePrice(perSecond, { params: {}, seconds: 5 })).toMatchObject({ coins: 41 });
  });

  it("refuses to guess when a per-unit model is given no quantity", () => {
    // Defaulting to a second here would sell a ten-second video for the price
    // of one, which is the expensive direction to be wrong in.
    expect(resolvePrice(perSecond, { params: {}, seconds: 0 })).toBe("missing_quantity");
  });

  it("stops billing at the cap, where the provider stops rendering", () => {
    const capped = [{ ...perSecond[0]!, maxBillableUnits: 10 }];
    expect(resolvePrice(capped, { params: {}, seconds: 45 })).toMatchObject({ coins: 82 });
    expect(resolvePrice(capped, { params: {}, seconds: 10 })).toMatchObject({ coins: 82 });
  });

  it("bills text in whole blocks, and never fewer than one", () => {
    const perBlock = [{ ...FLAT, pricingMode: "derived" as const, microCreditsPer1kInput: 1_200_000, providerUnitsPer1kInput: 6 }];
    expect(resolvePrice(perBlock, { params: {}, characters: 1 })).toMatchObject({ coins: 2 });
    expect(resolvePrice(perBlock, { params: {}, characters: 1000 })).toMatchObject({ coins: 2 });
    expect(resolvePrice(perBlock, { params: {}, characters: 2500 })).toMatchObject({ coins: 4 });
  });
});
