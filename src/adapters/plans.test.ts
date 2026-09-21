import { describe, expect, it, vi } from "vitest";
import { createDemoPlansService } from "./demo/plans";
import { createHttpPlansService } from "./http/plans";
import { createHttpClient } from "./http/client";
import { PLAN_LADDER } from "../data/planLadder";

const BASE_URL = "https://api.test/api/v1";

function harness(response: Response) {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { plans: createHttpPlansService(client), fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * The rate rides on the same response as the ladder, because a card prices in
 * Toman and what a dollar costs changes daily. Deliberately not the seed
 * constant: a screen still reading a compiled-in number would agree with the
 * seed and disagree with this.
 */
const RATE = 235_854;
const served = (plans: unknown) => json({ plans, tomanPerUsd: RATE });

describe("the plans port", () => {
  it("reads the public ladder and the day's rate together", async () => {
    const { plans, fetchImpl } = harness(served(PLAN_LADDER));
    await expect(plans.list()).resolves.toEqual({ plans: PLAN_LADDER, tomanPerUsd: RATE });
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe("https://api.test/api/v1/plans");
  });

  /**
   * Without a rate no Toman figure on the page means anything, and the screens
   * would render NaN into a price. Failing the parse is the loud version of
   * that, and it is what `useTomanPerUsd` relies on never having to handle.
   */
  it("refuses a response with no exchange rate", async () => {
    const { plans } = harness(json({ plans: PLAN_LADDER }));
    await expect(plans.list()).rejects.toThrow();
  });

  it("refuses a rate of zero, which would price every plan at nothing", async () => {
    const { plans } = harness(json({ plans: PLAN_LADDER, tomanPerUsd: 0 }));
    await expect(plans.list()).rejects.toThrow();
  });

  it("keeps the served order, because it is the order the cards read in", async () => {
    const reversed = [...PLAN_LADDER].reverse();
    const { plans } = harness(served(reversed));
    await expect(plans.list()).resolves.toMatchObject({ plans: reversed });
  });

  it("refuses a ladder missing the total a customer is charged against", async () => {
    const [first, ...rest] = PLAN_LADDER;
    const { coinsPerTerm: _dropped, ...withoutTotal } = first!;
    const { plans } = harness(served([withoutTotal, ...rest]));
    await expect(plans.list()).rejects.toThrow();
  });

  /**
   * A plan the database has never heard of is worse than no plan: the card is
   * bought, the tier does not move, and the padlock the purchase was meant to
   * open stays shut. Better to fail the parse.
   */
  it("refuses a tier outside the three the gate knows about", async () => {
    const { plans } = harness(served([{ ...PLAN_LADDER[0]!, tier: 4 }]));
    await expect(plans.list()).rejects.toThrow();
  });

  it("serves the database's own export in demo mode", async () => {
    await expect(createDemoPlansService().list()).resolves.toMatchObject({ plans: PLAN_LADDER });
  });

  it("agrees with the HTTP adapter field for field", async () => {
    const demo = await createDemoPlansService().list();
    const { plans } = harness(served(PLAN_LADDER));
    // Rates apart: demo mode has no `fx_rates` to read and quotes the seed.
    expect((await plans.list()).plans).toEqual(demo.plans);
  });
});
