import { describe, expect, it } from "vitest";
import {
  COIN_USD,
  KIE_CREDIT_USD,
  MARGIN,
  MICRO_CREDITS_PER_COIN,
  NO_CTX,
  RATES_FALLBACK,
  coinsFor,
  coinsForKieCredits,
  coinsToMicroCredits,
  microCreditsFor,
  microCreditsToCoins,
} from "./pricing";

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
  // `only()` returns null where `pick()` would fall back to a default. A default
  // here would invent a price for a job the provider cannot run, and the create
  // button would open on a generation that is guaranteed to fail.
  const hailuo = RATES_FALLBACK["hailuo-2-3"];

  it("prices the combinations the provider offers", () => {
    expect(hailuo?.({ resolution: "768P", duration: 6 }, NO_CTX)).toBe(45);
    expect(hailuo?.({ resolution: "1080P", duration: 6 }, NO_CTX)).toBe(80);
  });

  it("returns null for a combination the provider does not offer", () => {
    expect(hailuo?.({ resolution: "1080P", duration: 10 }, NO_CTX)).toBeNull();
  });

  it("never turns a null into a chargeable price", () => {
    const unsellable = hailuo?.({ resolution: "1080P", duration: 10 }, NO_CTX);
    expect(unsellable).not.toBe(0);
    expect(unsellable).toBeNull();
  });
});
