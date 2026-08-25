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
//   • On purchase the account is granted `coinsPerTerm` coins.
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
// The ladder itself no longer lives here. `GET /plans` serves it, screens read
// it through `usePlanLadder()`, and what is left in this file is the arithmetic
// around it: the Toman conversion, the margin audit, and the "what can I make
// with this" estimates. Those are derivations, not facts about a plan, and the
// API has no opinion on them.

import { ANNUAL_MONTHS, COIN_USD, MARGIN, coinsForVariantId, priceCoins } from "./pricing";
import { FAMILIES, defaultInput, variantControls } from "./models";
import type { Plan, Tier } from "../runtime/contracts/plans";
import type { InputMap } from "../components/controls";

export { ANNUAL_MONTHS, COIN_USD };
export type { Plan, Tier };
export const TOMAN_PER_USD = 170_000; // set 2026-07 by owner ($50 ≈ 8.5M Toman)

/** Days a grant stays spendable before it expires. Read-time expiry in the ledger. */
export const MONTHLY_EXPIRY_DAYS = 30;
/** Company plans (later) get a one-year bucket instead. */
export const COMPANY_EXPIRY_DAYS = 365;
/* ANNUAL_MONTHS moved to @vgen/core and is re-exported below. The sheet
   multiplies by it to show a total and the API multiplies by it to charge one;
   two copies of that number is two ways to quote one price. */

/**
 * Simultaneous generations for an account with no plan.
 *
 * One. A signup gift is a trial, and a trial that can saturate the queue is a
 * free account being used as a batch pipeline.
 */
export const FREE_CONCURRENT_JOBS = 1;

/** How many generations this account may run at once. */
export function concurrencyForPlan(plans: readonly Plan[], planId: string | null | undefined): number {
  if (!planId) return FREE_CONCURRENT_JOBS;
  return plans.find((p) => p.code === planId)?.maxConcurrentJobs ?? FREE_CONCURRENT_JOBS;
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
  return plan.coinsPerTerm * (COIN_USD / MARGIN);
}

/** Coins per dollar — the number a shopper is really comparing. */
export function coinsPerUsd(plan: Plan, annual = false): number {
  return plan.coinsPerTerm / usdOf(plan, annual);
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
  return usdOf(plan, annual) / (plan.coinsPerTerm * (COIN_USD / MARGIN));
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
export function auditPlans(plans: readonly Plan[]): string[] {
  const problems: string[] = [];
  for (const annual of [false, true]) {
    const cycle = annual ? "annual" : "monthly";
    // Sort rather than trusting the served order: it is the order the cards are
    // meant to read in, and a cheap plan appended at the end of it is a natural
    // edit that used to report a false inversion.
    const ladder = plans
      .filter((p) => !annual || p.annualUsdPerMonth != null)
      .slice()
      .sort((a, b) => usdOf(a, annual) - usdOf(b, annual));
    for (let i = 1; i < ladder.length; i++) {
      const lo = ladder[i - 1]!;
      const hi = ladder[i]!;
      if (coinsPerUsd(hi, annual) < coinsPerUsd(lo, annual)) {
        problems.push(
          `ladder inverts at "${hi.code}" (${cycle}): ` +
            `${coinsPerUsd(hi, annual).toFixed(2)} coins/$ vs "${lo.code}" ${coinsPerUsd(lo, annual).toFixed(2)}`,
        );
      }
    }
    for (const plan of ladder) {
      const m = planMargin(plan, annual);
      const floor = annual ? MIN_PLAN_MARGIN_ANNUAL : MIN_PLAN_MARGIN_MONTHLY;
      if (m < floor) {
        problems.push(
          `"${plan.code}" (${cycle}) clears only ${m.toFixed(3)}× — floor is ${floor}×. ` +
            `${plan.coinsPerTerm} coins cost us $${(plan.coinsPerTerm * (COIN_USD / MARGIN)).toFixed(2)} ` +
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
/**
 * Minimum tier per family, read off the catalogue.
 *
 * This used to be a hand-kept map beside the plan ladder, which made it a second
 * list of facts about the catalogue that nothing forced to agree with the
 * catalogue. Four families added later were missing from it entirely. `minTier`
 * is a field on the family now — declared where the family is, carried into
 * `provider_models.capabilities`, and served by `GET /catalog` — so a family
 * cannot exist without one.
 */
export const MODEL_MIN_TIER: Record<string, Tier> = Object.fromEntries(FAMILIES.map((family) => [family.id, family.minTier]));

/**
 * Minimum tier for a family. An unknown family LOCKS rather than unlocks.
 *
 * This defaulted to tier 1, which failed in the giveaway direction: four
 * families added later — gemini-omni, elevenlabs, topaz, recraft — were silently
 * available on the cheapest plan, and Gemini Omni costs up to 210 KIE credits a
 * video. Missing config should cost us a sale, never the margin. The type now
 * makes `minTier` required on a family, so the only way to reach the fallback
 * is to ask about a family that does not exist.
 */
export function minTierFor(familyId: string): Tier {
  return MODEL_MIN_TIER[familyId] ?? 3;
}

/**
 * The tier a user actually has.
 *
 * No plan is tier 1, not tier 0. A new account holds a 12-coin signup gift, and
 * the cheapest tier-1 models cost about one coin — so tier 1 is what makes that
 * gift a real trial rather than a number it cannot spend. Everything dearer is
 * exactly what we want them to see and be unable to reach yet.
 */
export function tierForPlan(plans: readonly Plan[], planId: string | null | undefined): Tier {
  if (!planId) return 1;
  return plans.find((p) => p.code === planId)?.tier ?? 1;
}

/** Can this account run this family at all? */
export function familyUnlocked(plans: readonly Plan[], familyId: string, planId: string | null | undefined): boolean {
  return tierForPlan(plans, planId) >= minTierFor(familyId);
}

/**
 * The cheapest plan that unlocks this family — what the lock should point at.
 *
 * Cheapest rather than "the next tier up", because tiers are not a price ladder:
 * Plus is tier 1 at $25 while Pro is tier 2 at $49, so naming a tier tells the
 * user nothing about what to buy. Returns null only if nothing unlocks it,
 * which check-combos.ts already prevents.
 */
export function cheapestPlanFor(plans: readonly Plan[], familyId: string): Plan | null {
  const need = minTierFor(familyId);
  return plans.filter((p) => p.tier >= need).sort((a, b) => a.monthlyUsd - b.monthlyUsd)[0] ?? null;
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
  return coinsForVariantId(id, input, { chars: 0, clipSeconds: 0 });
}

const IMAGE_ANCHOR_ID = "gpt-image-2";
const VIDEO_ANCHOR_ID = "kling-3";

export const COST_PER_IMAGE = anchor(IMAGE_ANCHOR_ID, { resolution: "1K" });
export const COST_PER_VIDEO5S = anchor(VIDEO_ANCHOR_ID, { mode: "pro", duration: 5, sound: false });

/**
 * What the two headline estimates were priced against, by name.
 *
 * Theirs prints "= 600 Nano Banana Pro Generations" and "~ 53 Seedance 2.0
 * videos" on the card — the model is named, not implied. That is the difference
 * between a number a buyer can check and one they have to take on faith, and on
 * a catalog whose models differ by 50x an unnamed "≈1,675 images" is closer to
 * a guess than a quote.
 *
 * Resolved from the catalog rather than written down, so renaming a model or
 * moving the anchor cannot leave the label pointing at the wrong thing.
 */
function anchorName(variantId: string): string | null {
  for (const f of FAMILIES) {
    const v = f.variants.find((x) => x.id === variantId);
    // The family name alone where the variant is the family's only shape;
    // otherwise both, because "Kling" and "Kling Pro" are different prices.
    if (v) return f.variants.length > 1 ? `${f.name} ${v.label}` : f.name;
  }
  return null;
}

export const IMAGE_ANCHOR_NAME = anchorName(IMAGE_ANCHOR_ID);
export const VIDEO_ANCHOR_NAME = anchorName(VIDEO_ANCHOR_ID);

/** Images per month on this plan, or null if the anchor lost its rate. */
export function estImages(plan: Plan): number | null {
  return COST_PER_IMAGE == null ? null : Math.floor(plan.coinsPerTerm / COST_PER_IMAGE);
}
/** 5-second videos per month on this plan, or null if the anchor lost its rate. */
export function estVideos(plan: Plan): number | null {
  return COST_PER_VIDEO5S == null ? null : Math.floor(plan.coinsPerTerm / COST_PER_VIDEO5S);
}

/* ---------------------------------------------------------------------------
   The comparison table.

   Two headline numbers ("≈1,675 images or 186 videos") tell a buyer almost
   nothing, because the models differ by 50x: the same coins buy 208 Z-Image
   frames or 6 Veo clips. Someone choosing a plan is really asking "how much of
   the thing I actually make does this get me", and only a per-model table
   answers that.

   Every row is priced through the same price rows the studios quote from,
   at a stated, ordinary setting — not an invented average. A row whose rate has
   gone missing returns null and renders as a dash rather than a made-up count,
   which is the same rule the plan cards already follow.
   --------------------------------------------------------------------------- */

export interface Benchmark {
  key: string;
  /** The variant that was actually priced — resolved from the catalog, never
   *  hand-written, so a row can't drift from the model it claims to be. */
  variantId: string;
  /** Family name, e.g. "Nano Banana". Latin, isolated when rendered. */
  family: string;
  /** Family id, so consumers can group rows without matching on display text. */
  familyId: string;
  /** Variant label, e.g. "Pro". A row named only by its family is a lie when
   *  the family holds variants that differ 4x in price. */
  variant: string;
  /** The setting the count is quoted at, spelled out so the number is checkable. */
  at: string;
  kind: "image" | "video" | "audio";
  /** Coins for one output at that setting, or null if the rate is gone. */
  coins: number | null;
}

/** What one output is called, so a cell reads "۵۵۰ تصویر" rather than "۵۵۰". */
export const UNIT_LABEL: Record<Benchmark["kind"], string> = { image: "تصویر", video: "ویدیو", audio: "کلیپ" };

/** Section headings, in the order the table shows them. */
export const KIND_LABEL: Record<Benchmark["kind"], string> = { video: "ویدیو", image: "تصویر", audio: "صدا" };

/** The control that decides how much an output costs, in preference order. A
 *  family exposes at most one of these, and it is the axis worth a row each. */
const QUALITY_KEYS = ["resolution", "quality", "mode", "upscale_factor", "rendering_speed"];

/** Videos are quoted at five seconds so the rows compare against each other. */
const BENCH_SECONDS = 5;
/** Speech is quoted per thousand characters — roughly a minute of narration. */
const BENCH_CHARS = 1000;

/**
 * Build a row for every priceable combination in the catalog.
 *
 * The first cut was ten hand-picked rows, which made an 18-family catalog look
 * like five video models and five image models — and worse, it silently chose
 * the cheapest variant of the two priciest families. Nothing hand-picked
 * survives: every family, every variant, and every step of that variant's
 * quality axis gets a row, so Seedance 2.0 appears at 480p, 720p, 1080p and 4K
 * the way the reference lists it.
 *
 * Prices come from `priceCoins` — the same function the Generate button calls —
 * rather than a private copy of the rate table, so the page cannot quote a
 * number the studio would disagree with. A combination the provider does not
 * sell prices as null and is dropped; that is the same rule everywhere else.
 */
export function buildBenchmarks(): Benchmark[] {
  const out: Benchmark[] = [];

  for (const family of FAMILIES) {
    for (const variant of family.variants) {
      const controls = variantControls(family, variant);
      const base = defaultInput(controls);

      // Pin duration so every video row is the same length. Without this a
      // 10-second default silently doubles one model against its neighbours.
      const dur = controls.find((c) => c.key === "duration");
      if (dur?.kind === "segment") {
        base.duration = (dur.options.find((o) => o.value === String(BENCH_SECONDS)) ?? dur.options[0]!).value;
      } else if (dur?.kind === "slider") {
        const v = Math.min(Math.max(BENCH_SECONDS, dur.min), dur.max);
        base.duration = dur.asString ? String(v) : v;
      }

      const axis = controls.find((c) => c.kind === "segment" && QUALITY_KEYS.includes(c.key));
      const steps = axis?.kind === "segment" ? axis.options.map((o) => ({ value: o.value, label: o.label })) : [null];

      for (const step of steps) {
        const input: InputMap = axis && step ? { ...base, [axis.key]: step.value } : base;
        const ctx = { chars: family.kind === "audio" ? BENCH_CHARS : 0, clipSeconds: 0 };
        const coins = priceCoins(variant, input, ctx);
        if (coins == null) continue; // not sold in that combination

        // What the number is quoted at, so the row is checkable.
        const parts: string[] = [];
        if (step) parts.push(step.label);
        if (base.duration != null) parts.push(`${base.duration} ثانیه`);
        if (family.kind === "audio") parts.push("۱۰۰۰ نویسه");

        out.push({
          key: `${variant.id}:${step?.value ?? "-"}`,
          variantId: variant.id,
          family: family.name,
          familyId: family.id,
          variant: variant.label,
          at: parts.join(" · ") || "پیش‌فرض",
          kind: family.kind,
          coins,
        });
      }
    }
  }

  /* Catalog order, deliberately unsorted.
     This used to sort every row by price, which read as tidy and was in fact
     the thing that made the table unreadable: four Nano Banana variants landed
     in four different places with unrelated models between them, so a reader
     comparing one model to another had to reassemble it from across the page.

     The loop above walks FAMILIES and then each family's variants, and FAMILIES
     is already the curated order the whole product uses — Nano Banana first
     because it is the most used, Seedance leading video — so simply not
     re-sorting gives grouped families in popularity order, and variants inside
     a family in the order the catalog presents them.

     Cost ordering is not lost: within a family the variants already run cheap
     to dear, which is the ladder that was actually useful. */
  return out;
}

/** How many of this output a plan's monthly coins buy. */
export function outputsPerMonth(plan: Plan, b: Benchmark): number | null {
  return b.coins == null || b.coins <= 0 ? null : Math.floor(plan.coinsPerTerm / b.coins);
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
