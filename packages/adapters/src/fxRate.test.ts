import { describe, expect, it } from "vitest";
import { FxRateUnavailableError, MAX_DAILY_MOVE, fetchTomanPerUsd, isPlausibleMove } from "./fxRate";

/**
 * The rate this returns is multiplied by every price in the product, unattended,
 * once a day. So the cases that matter are not "does it parse a good response"
 * but "what does it do with a bad one" — every path out of here that is not a
 * plausible number has to be a throw, because the alternative is a plan quietly
 * costing ten times too much or nothing at all.
 */

const answer = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const wallex = (lastPrice: unknown) => ({ result: { symbols: { USDTTMN: { stats: { lastPrice } } } } });

describe("reading the day's rate off Wallex", () => {
  it("takes the USDT/Toman last price, as a whole Toman", async () => {
    // The shape and the magnitude are the live response's, recorded 2026-09-12.
    expect(await fetchTomanPerUsd(answer(wallex("235854.0000000000000000")))).toEqual({
      tomanPerUsd: 235854,
      source: "wallex",
    });
  });

  it("rounds, so the Rial stored stays exactly ten times the Toman served", async () => {
    // The browser rounds a price to the nearest thousand Toman from what it is
    // served and the checkout rounds from the Rial column. A fractional Toman
    // here puts those two on opposite sides of a boundary, and the checkout
    // sheet shows the customer a mismatch warning when they disagree.
    const { tomanPerUsd } = await fetchTomanPerUsd(answer(wallex("235854.6")));
    expect(Number.isInteger(tomanPerUsd)).toBe(true);
    expect((tomanPerUsd * 10) / 10).toBe(tomanPerUsd);
  });

  it.each([
    ["the pair is missing", { result: { symbols: {} } }],
    ["the body is an error object", { message: "rate limited" }],
    ["the body is not JSON at all", "<html>maintenance</html>"],
    ["the price is not a number", wallex("unavailable")],
    ["the price is null", wallex(null)],
    ["the price is zero", wallex("0")],
    ["the price is negative", wallex("-235854")],
  ])("refuses to answer when %s", async (_case, body) => {
    await expect(fetchTomanPerUsd(answer(body))).rejects.toBeInstanceOf(FxRateUnavailableError);
  });

  it("refuses an error status even when the body parses", async () => {
    await expect(fetchTomanPerUsd(answer(wallex("235854"), 503))).rejects.toThrow(/503/);
  });

  it("reports an unreachable source rather than crashing the caller", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchTomanPerUsd(offline)).rejects.toBeInstanceOf(FxRateUnavailableError);
  });
});

describe("the plausibility band", () => {
  const current = 200_000;

  it("passes a move the Toman actually makes", () => {
    expect(isPlausibleMove(current * 1.05, current)).toBe(true);
    expect(isPlausibleMove(current * 0.95, current)).toBe(true);
  });

  it("catches a Rial figure read as a Toman one, which is the 10x slip", () => {
    expect(isPlausibleMove(current * 10, current)).toBe(false);
    expect(isPlausibleMove(current / 10, current)).toBe(false);
  });

  it("holds the line exactly at the band, in both directions", () => {
    expect(isPlausibleMove(current * (1 + MAX_DAILY_MOVE), current)).toBe(true);
    expect(isPlausibleMove(current * (1 + MAX_DAILY_MOVE) + 1, current)).toBe(false);
    expect(isPlausibleMove(current * (1 - MAX_DAILY_MOVE), current)).toBe(true);
    expect(isPlausibleMove(current * (1 - MAX_DAILY_MOVE) - 1, current)).toBe(false);
  });

  it("has nothing to compare against on a database with no rate yet", () => {
    // Not a licence to write anything: fetchTomanPerUsd has already refused
    // everything that is not a positive finite number by this point.
    expect(isPlausibleMove(235_854, null)).toBe(true);
    expect(isPlausibleMove(235_854, 0)).toBe(true);
  });
});
