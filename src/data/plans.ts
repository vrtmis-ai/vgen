// Subscription plans (پلن‌های اشتراکی) for the buy screen.
//
// Owner decision 2026-07-29: **plan-only**. There are no one-time coin packs any
// more — buying a plan buys a fixed window of access.
//
// IMPORTANT — this is a PREPAID PASS, not an auto-renewing subscription.
// Owner, verbatim: buying Pro does not mean 8.3M Toman every month forever; it
// activates 30 days. When those 30 days are up the plan simply ends, and the
// user buys again if they want to continue. Nothing is charged automatically,
// there is no card on file, and there is nothing to "cancel".
//
// How a plan behaves:
//   • On purchase the account is granted `coinsPerMonth + bonus` coins.
//   • That grant EXPIRES after MONTHLY_EXPIRY_DAYS. Unused coins do not roll
//     over into a later purchase.
//   • The expiry is ours alone. The underlying KIE credits never expire, so an
//     unspent coin costs us nothing — it is pure margin, not a liability.
//   • `annualUsdPerMonth` is the per-month rate when 12 months are paid upfront
//     in ONE transaction. The user is not billed again during that year, but the
//     *grant* still lands month by month — paying for a year does not hand over
//     12 months of coins on day one.
//   • Company plans (not built yet) grant a single 1-year bucket instead — see
//     COMPANY_EXPIRY_DAYS.
//
// This shape is also what the payment rails can actually do: ZarinPal is a
// one-shot card gateway, so recurring card-on-file billing was never available.
//
// Economics: 1 coin = $0.05 of face value = $0.025 of our KIE cost (5 credits).
// Iranian users pay Toman via ZarinPal. TOMAN_PER_USD is THE one constant to
// update when the exchange rate moves — every displayed price derives from it.
//
// NOTE: enforcing renewals, expiry and tier access needs the backend; until then
// the UI reads this file and the backend phase wires it up against the same data.

import { coinsForKieCredits, COIN_USD, MARGIN, RATES_FALLBACK } from "./pricing";
import { FAMILIES } from "./models";
import type { InputMap } from "../components/controls";

export { COIN_USD };
export const TOMAN_PER_USD = 170_000; // set 2026-07 by owner ($50 ≈ 8.5M Toman)

/** Days a grant stays spendable before it expires. Read-time expiry in the ledger. */
export const MONTHLY_EXPIRY_DAYS = 30;
/** Company plans (later) get a one-year bucket instead. */
export const COMPANY_EXPIRY_DAYS = 365;
/** Months paid upfront on the annual option. */
export const ANNUAL_MONTHS = 12;

/** Access tier a plan grants. Models declare the minimum tier that unlocks them. */
export type Tier = 1 | 2 | 3;

export interface Plan {
  id: string;
  name: string; // display name (latin, language-neutral)
  /** Coins granted at the start of every billing month. */
  coinsPerMonth: number;
  /** Extra coins in that same monthly grant (the volume discount, made visible). */
  bonus: number;
  tier: Tier; // model-access tier this plan unlocks
  monthlyUsd: number; // billed every month
  annualUsdPerMonth?: number; // per-month rate when 12 months are paid upfront
  /** "entry" plans are the cheap on-ramp; "main" plans are the money cards. */
  group: "entry" | "main";
  tag?: "test" | "gift" | "popular" | "best"; // label key, translated in UI
  popular?: boolean;
}

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", coinsPerMonth: 30, bonus: 0, tier: 1, monthlyUsd: 1.5, group: "entry", tag: "test" },
  { id: "basic", name: "Basic", coinsPerMonth: 80, bonus: 0, tier: 1, monthlyUsd: 4, group: "entry" },
  { id: "flow", name: "Flow", coinsPerMonth: 150, bonus: 0, tier: 1, monthlyUsd: 7.5, group: "entry" },
  { id: "plus", name: "Plus", coinsPerMonth: 500, bonus: 25, tier: 1, monthlyUsd: 25, group: "entry", tag: "gift" },
  { id: "pro", name: "Pro", coinsPerMonth: 1000, bonus: 100, tier: 2, monthlyUsd: 49, annualUsdPerMonth: 39, group: "main", tag: "popular", popular: true },
  // bonus raised 200 → 300: at 200 this plan gave FEWER coins per Toman than Pro
  // (22.22 vs 22.45), so doubling your spend bought you less. See assertLadder().
  { id: "studio", name: "Studio", coinsPerMonth: 2000, bonus: 300, tier: 3, monthlyUsd: 99, annualUsdPerMonth: 80, group: "main" },
  // Bonus trimmed 450 → 350 (owner decision 2026-08-02). At 450 the annual cycle
  // cleared only 1.264×, under the floor below; 100 coins out of 3450 is 2.9% to
  // the user and lifts both cycles — annual to 1.301×, monthly to 1.660×. Chosen
  // over raising the annual price because that would have pushed the single
  // ZarinPal transaction from 222M to 230M Toman, and whether the gateway even
  // accepts 222M is still an open question (HANDOFF §6).
  { id: "creator", name: "Creator", coinsPerMonth: 3000, bonus: 350, tier: 3, monthlyUsd: 139, annualUsdPerMonth: 109, group: "main", tag: "best" },
];

/** Total coins a plan grants each month. */
export function monthlyCoins(plan: Plan): number {
  return plan.coinsPerMonth + plan.bonus;
}

/** List price per month on the given cycle, before any account-level adjustment. */
function usdOf(plan: Plan, annual: boolean): number {
  return annual ? (plan.annualUsdPerMonth ?? plan.monthlyUsd) : plan.monthlyUsd;
}

/** Just enough of an account for pricing to look at. Kept structural so this
 *  module does not have to import the session type. */
export interface PricingAccount {
  isTeam?: boolean | undefined;
}

/**
 * What THIS account pays — which is not always what the plan row says.
 *
 * §14: an admin can flag a Vgen team account, and a flagged account buys at cost
 * rather than at margin, because the credit comes back to us and there is no
 * margin to take. Every price the app shows or charges goes through here, so
 * that stays one decision in one place rather than a condition sprinkled across
 * call sites — and so team purchases stay separable in the books. Their KIE cost
 * is real; only the profit is zero, and a discount applied at the display layer
 * would hide that.
 *
 * The seam is worth more than today's single branch: it is also where a coupon,
 * a regional price or a grandfathered rate would go.
 */
export function effectiveUsd(plan: Plan, annual: boolean, account?: PricingAccount): number {
  if (!account?.isTeam) return usdOf(plan, annual);
  return monthlyCoins(plan) * (COIN_USD / MARGIN);
}

/** Coins per dollar — the number a shopper is really comparing. */
export function coinsPerUsd(plan: Plan, annual = false): number {
  return monthlyCoins(plan) / usdOf(plan, annual);
}

/**
 * What a plan actually earns against what its coins cost us to honour.
 *
 * `pricing.ts` charges MARGIN× on every job, but that is the margin on a coin at
 * face value — and plans sell coins below face value. The discount comes
 * straight off the top, so the blended number is the real one: Creator annual
 * clears 1.26×, not the 2× the constant advertises.
 */
export function planMargin(plan: Plan, annual = false): number {
  return usdOf(plan, annual) / (monthlyCoins(plan) * (COIN_USD / MARGIN));
}

/**
 * Floors a plan's margin may not fall below. Two numbers, not one.
 *
 * Margin is exactly `40 / coinsPerUsd`, which makes the ladder rule and the
 * floor rule the same statement read in opposite directions: "a dearer plan must
 * give more coins per dollar" IS "a dearer plan must earn a thinner margin". So
 * the largest plan is always the binding one, and no plan can be repaired alone
 * — pushing Creator's margin up past Studio's inverts the ladder.
 *
 * Annual is allowed to run leaner on purpose. It takes twelve months up front,
 * carries no churn risk for a year, and its later months' unspent coins expire
 * into profit. A single floor across both cycles was holding healthy monthly
 * plans hostage to the thinnest annual one.
 *
 * 1.0 is break-even on provider cost alone — before ZarinPal's cut, the 50-coin
 * referral payout, or the signup gift. And every margin here assumes the user
 * burns their whole grant; at 70% usage Creator annual clears 1.86×, not 1.30×.
 * The floor exists for the power user who really does spend it all.
 */
export const MIN_PLAN_MARGIN_MONTHLY = 1.6;
export const MIN_PLAN_MARGIN_ANNUAL = 1.3;

/**
 * Everything that must stay true of the plan table, as a list of problems.
 *
 * Two rules:
 *
 *  1. The ladder must never invert — spending more must never buy fewer coins.
 *     Not hypothetical: Studio shipped at 22.22 coins/$ against Pro's 22.45, so
 *     the plan costing twice as much was the worse deal in all three price
 *     columns, and nobody noticed because the cards show totals, not unit rates.
 *
 *  2. Every plan must clear its cycle's margin floor. The ladder alone does not catch
 *     this: raising Creator's bonus to 1300 gives away $107.50 of KIE credit for
 *     $109 and still passes rule 1, because it stays above Studio's coins/$.
 *
 * This used to run — rule 1 only — as a bare call during module evaluation, so a
 * bad edit threw before React mounted and produced the blank screen the
 * ErrorBoundary exists to prevent and cannot catch. It reports instead of
 * throwing, and `scripts/check-combos.ts` fails CI on a non-empty result.
 */
export function auditPlans(): string[] {
  const problems: string[] = [];
  for (const annual of [false, true]) {
    const cycle = annual ? "annual" : "monthly";
    // Sort rather than trusting PLANS' order: appending a cheap plan at the end
    // of the array is a natural edit and used to report a false inversion.
    const ladder = PLANS.filter((p) => !annual || p.annualUsdPerMonth != null)
      .slice()
      .sort((a, b) => usdOf(a, annual) - usdOf(b, annual));
    for (let i = 1; i < ladder.length; i++) {
      const lo = ladder[i - 1]!;
      const hi = ladder[i]!;
      if (coinsPerUsd(hi, annual) < coinsPerUsd(lo, annual)) {
        problems.push(
          `ladder inverts at "${hi.id}" (${cycle}): ` +
            `${coinsPerUsd(hi, annual).toFixed(2)} coins/$ vs "${lo.id}" ${coinsPerUsd(lo, annual).toFixed(2)}`,
        );
      }
    }
    for (const plan of ladder) {
      const m = planMargin(plan, annual);
      const floor = annual ? MIN_PLAN_MARGIN_ANNUAL : MIN_PLAN_MARGIN_MONTHLY;
      if (m < floor) {
        problems.push(
          `"${plan.id}" (${cycle}) clears only ${m.toFixed(3)}× — floor is ${floor}×. ` +
            `${monthlyCoins(plan)} coins cost us $${(monthlyCoins(plan) * (COIN_USD / MARGIN)).toFixed(2)} ` +
            `against $${usdOf(plan, annual)} of revenue.`,
        );
      }
    }
  }
  // The anchors below feed every plan card's "≈N images / ≈N videos". They no
  // longer throw when a rate disappears, so this is the only thing that notices.
  if (COST_PER_IMAGE == null) problems.push(`pricing anchor "gpt-image-2" lost its rate — plan cards drop the image estimate`);
  if (COST_PER_VIDEO5S == null) problems.push(`pricing anchor "kling-3" lost its rate — plan cards drop the video estimate`);
  return problems;
}

/* ---- model access gating (owner-tunable, single source of truth) ----------
   tier 1 — everyday/economy models, every plan unlocks these
   tier 2 — pro creator models (Pro and up)
   tier 3 — flagship models (Studio / Creator only)
   NOTE: real enforcement happens in the backend phase; the UI reads this map
   to communicate access on plan cards (and later to lock model pages). */
export const MODEL_MIN_TIER: Record<string, Tier> = {
  "z-image": 1,
  qwen: 1,
  "grok-image": 1,
  seedream: 1,
  "gpt-image": 1,
  wan: 1,
  hailuo: 1,
  recraft: 1, // 0.5–1 credit — cheapest thing in the catalogue
  elevenlabs: 1, // 6–14 credits per 1000 characters
  topaz: 1, // a utility; upscaling someone's own file shouldn't need a big plan
  "nano-banana": 2,
  flux: 2,
  imagen: 2,
  ideogram: 2,
  seedance: 2,
  kling: 2,
  "gemini-omni": 2, // 63–210 credits per video, in Kling's range
  veo: 3,
};

/**
 * Minimum tier for a family. An unlisted family LOCKS rather than unlocks.
 *
 * This defaulted to tier 1, which failed in the giveaway direction: four
 * families added later — gemini-omni, elevenlabs, topaz, recraft — were silently
 * available on the cheapest plan, and Gemini Omni costs up to 210 KIE credits a
 * video. Missing config should cost us a sale, never the margin.
 * `scripts/check-combos.ts` now fails if any family is unlisted.
 */
export function minTierFor(familyId: string): Tier {
  return MODEL_MIN_TIER[familyId] ?? 3;
}

/** Family display names newly unlocked AT this tier (not cumulative). */
export function tierUnlockNames(tier: Tier): string[] {
  return FAMILIES.filter((f) => minTierFor(f.id) === tier)
    .map((f) => f.name)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* ---- "what can I make with this?" — derived from the real rate table ------
   anchors: a popular image (GPT Image 1K) and a popular video (Kling pro 5s).
   Derived, not hardcoded: repricing models updates every plan card. */
/**
 * Rates can be null (combination not offered), and an anchor going null means
 * the catalog moved under us.
 *
 * This used to throw, which meant a catalog edit took the whole app down before
 * React mounted — the same blank screen `auditPlans` was pulled out of module
 * evaluation to avoid. It returns null instead: `auditPlans` reports it so CI
 * fails, and the plan card drops that one estimate rather than showing a number
 * derived from nothing.
 */
function anchor(id: string, input: InputMap): number | null {
  const credits = RATES_FALLBACK[id]?.(input, { chars: 0, clipSeconds: 0 });
  return credits == null ? null : coinsForKieCredits(credits);
}

export const COST_PER_IMAGE = anchor("gpt-image-2", { resolution: "1K" });
export const COST_PER_VIDEO5S = anchor("kling-3", { mode: "pro", duration: 5, sound: false });

/** Images per month on this plan, or null if the anchor lost its rate. */
export function estImages(plan: Plan): number | null {
  return COST_PER_IMAGE == null ? null : Math.floor(monthlyCoins(plan) / COST_PER_IMAGE);
}
/** 5-second videos per month on this plan, or null if the anchor lost its rate. */
export function estVideos(plan: Plan): number | null {
  return COST_PER_VIDEO5S == null ? null : Math.floor(monthlyCoins(plan) / COST_PER_VIDEO5S);
}

/** Toman price for a USD amount (rounded to the nearest 1000). */
export function toman(usd: number): number {
  return Math.round((usd * TOMAN_PER_USD) / 1000) * 1000;
}

/** Percent saved per month by paying for a year upfront (0 if no annual option). */
export function annualDiscountPct(plan: Plan): number {
  if (plan.annualUsdPerMonth == null) return 0;
  return Math.round((1 - plan.annualUsdPerMonth / plan.monthlyUsd) * 100);
}

/** Total charged today when the user picks the annual option. */
export function annualTotalUsd(plan: Plan, account?: PricingAccount): number | null {
  if (plan.annualUsdPerMonth == null) return null;
  return effectiveUsd(plan, true, account) * ANNUAL_MONTHS;
}
