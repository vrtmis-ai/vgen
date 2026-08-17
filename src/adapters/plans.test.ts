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

describe("the plans port", () => {
  it("reads the public ladder and hands back the array, not the envelope", async () => {
    const { plans, fetchImpl } = harness(json({ plans: PLAN_LADDER }));
    await expect(plans.list()).resolves.toEqual(PLAN_LADDER);
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe("https://api.test/api/v1/plans");
  });

  it("keeps the served order, because it is the order the cards read in", async () => {
    const reversed = [...PLAN_LADDER].reverse();
    const { plans } = harness(json({ plans: reversed }));
    await expect(plans.list()).resolves.toEqual(reversed);
  });

  it("refuses a ladder missing the total a customer is charged against", async () => {
    const [first, ...rest] = PLAN_LADDER;
    const { coinsPerTerm: _dropped, ...withoutTotal } = first!;
    const { plans } = harness(json({ plans: [withoutTotal, ...rest] }));
    await expect(plans.list()).rejects.toThrow();
  });

  /**
   * A plan the database has never heard of is worse than no plan: the card is
   * bought, the tier does not move, and the padlock the purchase was meant to
   * open stays shut. Better to fail the parse.
   */
  it("refuses a tier outside the three the gate knows about", async () => {
    const { plans } = harness(json({ plans: [{ ...PLAN_LADDER[0]!, tier: 4 }] }));
    await expect(plans.list()).rejects.toThrow();
  });

  it("serves the database's own export in demo mode", async () => {
    await expect(createDemoPlansService().list()).resolves.toEqual(PLAN_LADDER);
  });

  it("agrees with the HTTP adapter field for field", async () => {
    const demo = await createDemoPlansService().list();
    const { plans } = harness(json({ plans: PLAN_LADDER }));
    expect(await plans.list()).toEqual(demo);
  });
});
