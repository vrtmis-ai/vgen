import { describe, expect, it } from "vitest";
import { grantedTotal, remainingRatio } from "./credits";
import type { CreditGrant, Wallet } from "../data/wallet";

const grant = (coinsGranted: number, coinsRemaining: number, id = String(coinsGranted)): CreditGrant => ({
  id,
  kind: "plan_monthly",
  coinsGranted,
  coinsRemaining,
  grantedAt: 0,
});

const wallet = (grants: CreditGrant[], spendable = grants.reduce((s, g) => s + g.coinsRemaining, 0)): Wallet => ({
  spendable,
  grants,
});

describe("what a balance is a balance of", () => {
  it("adds up the buckets the wallet currently holds", () => {
    expect(grantedTotal(wallet([grant(12, 12), grant(1300, 1238)]))).toBe(1312);
  });

  it("reports the fraction still spendable", () => {
    expect(remainingRatio(wallet([grant(100, 25)]))).toBe(0.25);
  });

  /**
   * A wallet with no grants is a real state, not a bug: the e2e fixture is one,
   * and so is an account whose buckets have all lapsed. `spendable / 0` is
   * Infinity or NaN, and a ring drawn from either claims something.
   */
  it("has no ratio when there is nothing to be a fraction of", () => {
    expect(remainingRatio(wallet([], 0))).toBeNull();
    expect(remainingRatio(wallet([], 40))).toBeNull();
  });

  it("cannot exceed its own end", () => {
    // `spendable` is the server's figure and the total is summed here, so the
    // two can disagree by a rounding step without either being wrong.
    expect(remainingRatio(wallet([grant(100, 100)], 100.4))).toBe(1);
    expect(remainingRatio(wallet([grant(100, 0)], -0))).toBe(0);
  });

  it("survives the hundredths a coin now bills in", () => {
    expect(grantedTotal(wallet([grant(0.16, 0.16), grant(1.3, 0.9)]))).toBeCloseTo(1.46, 5);
  });
});
