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

import { coinsForKieCredits, COIN_USD, RATES_FALLBACK } from "./pricing";
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
  { id: "creator", name: "Creator", coinsPerMonth: 3000, bonus: 450, tier: 3, monthlyUsd: 139, annualUsdPerMonth: 109, group: "main", tag: "best" },
];

/** Total coins a plan grants each month. */
export function monthlyCoins(plan: Plan): number {
  return plan.coinsPerMonth + plan.bonus;
}

/** Coins per dollar — the number a shopper is really comparing. */
export function coinsPerUsd(plan: Plan, annual = false): number {
  const usd = annual ? (plan.annualUsdPerMonth ?? plan.monthlyUsd) : plan.monthlyUsd;
  return monthlyCoins(plan) / usd;
}

/**
 * A price ladder must never invert: spending more must never buy fewer coins.
 *
 * This is not hypothetical — Studio shipped giving 22.22 coins/$ against Pro's
 * 22.45, so the plan that cost twice as much was the worse deal, in all three
 * price columns. Nobody noticed because the cards show totals, not unit rates.
 * Fail the build instead of quietly punishing the biggest spenders.
 */
function assertLadder(): void {
  for (const annual of [false, true]) {
    const ladder = PLANS.filter((p) => !annual || p.annualUsdPerMonth != null);
    for (let i = 1; i < ladder.length; i++) {
      const lo = ladder[i - 1]!;
      const hi = ladder[i]!;
      if (coinsPerUsd(hi, annual) < coinsPerUsd(lo, annual)) {
        throw new Error(
          `plan ladder inverts at "${hi.id}" (${annual ? "annual" : "monthly"}): ` +
            `${coinsPerUsd(hi, annual).toFixed(2)} coins/$ vs "${lo.id}" ${coinsPerUsd(lo, annual).toFixed(2)}`,
        );
      }
    }
  }
}
assertLadder();

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
/** Rates can be null now (combination not offered). An anchor going null is a
    catalog mistake, so fail loudly instead of rendering NaN on every plan card. */
function anchor(id: string, input: InputMap): number {
  const credits = RATES_FALLBACK[id]?.(input, 0);
  if (credits == null) throw new Error(`pricing anchor "${id}" no longer has a rate`);
  return coinsForKieCredits(credits);
}

export const COST_PER_IMAGE = anchor("gpt-image-2", { resolution: "1K" });
export const COST_PER_VIDEO5S = anchor("kling-3", { mode: "pro", duration: 5, sound: false });

/** Images per month on this plan (spending the whole grant on images). */
export function estImages(plan: Plan): number {
  return Math.floor(monthlyCoins(plan) / COST_PER_IMAGE);
}
/** 5-second videos per month on this plan (spending the whole grant on video). */
export function estVideos(plan: Plan): number {
  return Math.floor(monthlyCoins(plan) / COST_PER_VIDEO5S);
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
export function annualTotalUsd(plan: Plan): number | null {
  return plan.annualUsdPerMonth == null ? null : plan.annualUsdPerMonth * ANNUAL_MONTHS;
}
