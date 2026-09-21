import type { Sql } from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ liveRate: vi.fn(), setRate: vi.fn(async () => true) }));
vi.mock("@vgen/db", () => db);

const { refreshFxRate } = await import("./fxRefresh");

// One transaction whose row lock answers nothing; the rate itself comes from the mocked repository.
const sql = { begin: (fn: (tx: unknown) => unknown) => fn(async () => []) } as unknown as Sql;
const market = (lastPrice: number): typeof fetch =>
  (async () => Response.json({ result: { symbols: { USDTTMN: { stats: { lastPrice: String(lastPrice) } } } } })) as unknown as typeof fetch;
const live = (tomanPerUsd: number, source: string, hoursAgo = 1) => ({
  rialPerUsd: tomanPerUsd * 10,
  source,
  validFrom: new Date(Date.now() - hoursAgo * 3_600_000),
});

describe("the daily rate refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  // Production sat on 170,000 for ten days: the hand-set row was due at once but
  // was still the baseline the band measured the 228,000 market against.
  it("replaces a placeholder however far the market has moved from it", async () => {
    db.liveRate.mockResolvedValue(live(170_000, "manual"));
    expect(await refreshFxRate(sql, { fetchImpl: market(228_301) })).toMatchObject({ outcome: "written", tomanPerUsd: 228_301 });
    expect(db.setRate).toHaveBeenCalledWith(expect.anything(), 2_283_010, "wallex");
  });

  it("still refuses an out-of-band move away from a measured rate", async () => {
    db.liveRate.mockResolvedValue(live(170_000, "wallex", 21));
    expect(await refreshFxRate(sql, { fetchImpl: market(228_301) })).toMatchObject({ outcome: "implausible" });
    expect(db.setRate).not.toHaveBeenCalled();
  });
});
