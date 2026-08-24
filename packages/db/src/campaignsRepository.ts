import type { Campaign, Plan } from "@vgen/contracts";
import type { Sql } from "postgres";

/**
 * The running campaign, if there is one.
 *
 * The window comes from `campaigns`. The two headline numbers do not — they are
 * folded out of the plan ladder, and that is the substance of this file rather
 * than an optimisation.
 *
 * The strip prints "up to N% off annual, plus up to M bonus coins" and sits
 * under the words "limited time". Both numbers therefore have to be what
 * checkout will actually honour. Stored on the campaign row they would be two
 * numbers somebody types in, and the first plan price change would make the
 * advertisement wrong while leaving it perfectly valid — a promise nothing
 * checks. Derived from `plans`, they are the same rows `POST /payments/orders`
 * prices from, so the strip cannot advertise a rate the till will refuse.
 *
 * What that means today: the discount is the annual saving already in the
 * ladder, and the bonus is the coins a plan already grants above its base. Both
 * are real and both are honoured. If a campaign ever needs a discount OF ITS
 * OWN, it becomes a column here AND a term in the pricing below — never a
 * number on a row that nothing enforces.
 */
export interface ActiveCampaignRepository {
  getActive(): Promise<Campaign | null>;
}

/** Just enough of the plans repository to fold. Structural, so tests need no database. */
export interface PlanLadderPort {
  list(): Promise<Plan[]>;
}

interface CampaignRow {
  code: string;
  ends_at: Date;
}

/**
 * Per cent saved each month by paying for a year at once, rounded to whole per
 * cent because "up to ۲۲٪" is what an advertisement says.
 *
 * Rounded rather than floored: at 21.58% the honest headline is 22, and the
 * copy says "up to", so the rounding direction cannot overstate what any
 * individual plan gives. A plan with no annual option saves nothing.
 */
function annualDiscountPct(plan: Plan): number {
  if (plan.annualUsdPerMonth === null || plan.monthlyUsd <= 0) return 0;
  return Math.round((1 - plan.annualUsdPerMonth / plan.monthlyUsd) * 100);
}

export class PostgresCampaignsRepository implements ActiveCampaignRepository {
  constructor(
    private readonly sql: Sql,
    private readonly plans: PlanLadderPort,
  ) {}

  async getActive(): Promise<Campaign | null> {
    /* Half-open on purpose: a campaign ending at midnight is over AT midnight,
       which is the instant the browser's own countdown reaches zero and the
       strip removes itself. `<=` would leave one second where the server still
       says yes and the strip has already gone.

       `limit 1` is belt to the exclusion constraint's braces — two overlapping
       windows cannot be inserted, so this only ever has one row to pick. */
    const [row] = await this.sql<CampaignRow[]>`
      select code, ends_at
      from campaigns
      where starts_at <= now() and ends_at > now()
      order by ends_at asc
      limit 1
    `;
    if (!row) return null;

    // Only reached when a campaign is running, which is a few weeks a year.
    // The rest of the time this route costs one indexed query and no fold.
    // `list()` is the memoised public document the plans route serves, so even
    // during a festival this is not a second read of the ladder.
    const plans = await this.plans.list();

    return {
      id: row.code,
      endsAt: row.ends_at.getTime(),
      maxDiscountPct: Math.max(0, ...plans.map(annualDiscountPct)),
      maxBonusCoins: Math.max(0, ...plans.map((plan) => plan.bonusCoins)),
    };
  }
}
