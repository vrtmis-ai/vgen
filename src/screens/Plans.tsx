/* Plan screen. Replaces the old "Wallet" pack screen after the owner's
   2026-07-29 decision that access is sold as plans rather than coin packs.

   A plan is a PREPAID PASS, not an auto-renewing subscription: buying activates
   30 days, and when they run out the user buys again if they want to continue.
   Nothing is charged automatically, so this screen must never promise renewal
   or offer a "cancel" — it said both in its first draft, which was a plain lie
   about how the user would be billed.

   Two states, both reachable today:
     • no plan     — the empty state the owner asked for. What a new user sees,
                     holding only their 12 signup-gift coins.
     • has a plan  — current plan, coins left in this period, expiry date.

   `currentPlanId` / `expiresAt` come from the backend once it exists; App passes
   null today, so the screen honestly renders the no-plan case rather than
   inventing one. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarCheck,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Crown,
  Feather,
  FilmSlate,
  ImageSquare,
  Info,
  Leaf,
  Lightning,
  LockKey,
  MusicNotes,
  PaintBrush,
  Palette,
  Sparkle,
  VideoCamera,
  X,
  XCircle,
} from "@phosphor-icons/react";
import {
  toman,
  annualDiscountPct,
  annualTotalUsd,
  effectiveUsd,
  buildBenchmarks,
  outputsPerMonth,
  KIND_LABEL,
  type Benchmark,
  type Plan,
  type PricingAccount,
} from "../data/plans";
import { usePlanLadder } from "../features/plans/PlansProvider";
import { CoinMark } from "../components/chrome";
import { useActiveCampaign } from "../features/session/useSession";
import { useAppServices } from "../runtime/AppServices";
import type { CheckoutOrder } from "../runtime/contracts/payment";
import { useI18n } from "../lib/i18n";
import type { Wallet } from "../data/wallet";

const TAG_KEY = { test: "w_tag_test", gift: "w_tag_gift", popular: "w_tag_popular", best: "w_tag_best" } as const;
const PLAN_AUDIENCE_KEY = {
  starter: "pl_for_starter",
  basic: "pl_for_basic",
  flow: "pl_for_flow",
  plus: "pl_for_plus",
  pro: "pl_for_pro",
  studio: "pl_for_studio",
  creator: "pl_for_creator",
} as const;
/** Bar widths on the card face, in percent. Fixed rather than random so the
    glyph is the same on every render and every machine. */
const VISUAL_BARS = [74, 52, 86, 63, 42, 70];
/**
 * One mark per plan, reading up the ladder as a maker's progression rather than
 * a spreadsheet's: a leaf for the one you try, a brush for the first real work,
 * a quill for output that comes easily, a palette for more range than one brush
 * gives, a bolt for daily production, a slate for professional work, a crown
 * for the top.
 *
 * The middle three were a cube, a waveform and a rising trend line — accurate
 * about volume and wrong about the product. This is a tool people make pictures
 * with; its plan ladder should not look like a billing dashboard.
 */
const PLAN_MARK = {
  starter: Leaf,
  basic: PaintBrush,
  flow: Feather,
  plus: Palette,
  pro: Lightning,
  studio: FilmSlate,
  creator: Crown,
} as const;
const PLAN_TOOL_KEYS = [
  "pl_tool_image",
  "pl_tool_video",
  "pl_tool_lipsync",
  "pl_tool_motion",
  "pl_tool_edit",
  "pl_tool_music",
  "pl_tool_speech",
  "pl_tool_chat",
] as const;

function PlanFeatures({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="border-t border-line pt-3">
      <p className="text-[10.5px] font-semibold text-ink2">{t("pl_engines_title")}</p>
      <div className={`mt-2 grid grid-cols-2 ${compact ? "gap-1" : "gap-1.5"}`}>
        {PLAN_TOOL_KEYS.map((key) => (
          <span key={key} className={`plans-tool-chip rounded-lg px-2 text-ink2 ${compact ? "py-1 text-[9px]" : "py-1.5 text-[10px]"}`}>
            {t(key)}
          </span>
        ))}
      </div>
      <p className={`${compact ? "mt-2 text-[9px]" : "mt-2.5 text-[10px]"} leading-relaxed text-ink3`}>
        {t(plan.tier >= 3 ? "pl_models_tier_3" : plan.tier >= 2 ? "pl_models_tier_2" : "pl_models_tier_1")}
      </p>
    </div>
  );
}

/**
 * The reward amber is what you are given: free generations, gift coins, the
 * money an annual cycle keeps in your pocket.
 *
 * It has now been three colours, and each move was the same lesson. Orange,
 * when orange was the CTA — so a card carried three oranges and none of them
 * pointed at the buy button. Then the stock success green, which reads as "OK"
 * rather than as something worth having. Then lime, until lime became the
 * brand and "press this" and "you get this" collapsed into one signal again.
 * Amber sits next to the lime without being it. See 4b in tokens.css.
 */
function UnlimitedBenefit({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const { t, n } = useI18n();
  if (plan.tier < 2) return null;
  const isProTrial = plan.code === "pro";
  return (
    <div className={`rounded-xl border border-reward-line bg-reward-wash ${compact ? "p-2" : "p-3"}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold text-reward">
        <Sparkle size={13} weight="fill" />
        {t(isProTrial ? "pl_unlimited_7d_title" : "pl_unlimited_title")}
      </div>
      <p className={`${compact ? "mt-1" : "mt-1.5"} text-[10px] leading-relaxed text-ink2`}>
        {isProTrial ? t("pl_unlimited_7d_sub") : t("pl_unlimited_sub").replace("{n}", n(50))}
      </p>
    </div>
  );
}

function PlanAccessList({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const { t, n } = useI18n();
  const rows = [
    { key: "tools", active: true, label: t("pl_all_studios") },
    { key: "advanced", active: plan.tier >= 2, label: t("pl_access_advanced") },
    { key: "flagship", active: plan.tier >= 3, label: t("pl_access_flagship") },
    {
      key: "unlimited",
      active: plan.tier >= 2,
      label: t(plan.code === "pro" ? "pl_access_unlimited_7d" : plan.tier >= 3 ? "pl_access_unlimited_daily" : "pl_access_unlimited"),
    },
    { key: "parallel", active: true, label: t("pl_parallel").replace("{n}", n(plan.maxConcurrentJobs)) },
    { key: "training", active: true, label: t("pl_benefit_training") },
  ];

  return (
    <div className={`border-t border-line ${compact ? "pt-2 text-[10px]" : "pt-3 text-[11.5px]"}`}>
      <p className={`${compact ? "mb-1.5" : "mb-2"} font-semibold text-ink2`}>{t("pl_access_title")}</p>
      <div className={`grid ${compact ? "grid-cols-2 gap-x-3 gap-y-1.5" : "grid-cols-1 gap-2"}`}>
        {rows.map((row) => {
          const Icon = row.active ? CheckCircle : XCircle;
          // The free-generation row is something given rather than something
          // included, so it ticks in the reward amber; the rest stay neutral.
          const tick = !row.active ? "text-ink3/45" : row.key === "unlimited" ? "text-reward" : "text-accent";
          return (
            <span key={row.key} className={`flex items-start gap-2 ${row.active ? "text-ink2" : "text-ink3/60"}`}>
              <Icon size={compact ? 11 : 13} weight="fill" className={`mt-0.5 shrink-0 ${tick}`} />
              <span className={row.active ? "" : "line-through decoration-ink3/35"}>{row.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Benchmark rows, grouped into their families, order preserved.
 *
 * The comparison lists variants, and a family can hold four of them. Ungrouped
 * they read as four unrelated models — which is what made the table look like a
 * jumble even though every row was correct. Grouping is also what makes
 * "show fewer" honest: cutting at three ROWS can leave a family half-shown,
 * which is worse than not showing it.
 */
interface VariantGroup {
  id: string;
  label: string;
  rows: Benchmark[];
}
interface FamilyGroup {
  id: string;
  name: string;
  variants: VariantGroup[];
  /** Total benchmark rows under this family — what the row count is cut on. */
  size: number;
}

function byFamily(rows: Benchmark[]): FamilyGroup[] {
  const out: FamilyGroup[] = [];
  for (const r of rows) {
    // Adjacent-only, not a map lookup: buildBenchmarks already emits families
    // and variants contiguously in catalog order, and this preserves that
    // rather than imposing an order of its own.
    let fam = out[out.length - 1];
    if (!fam || fam.id !== r.familyId) {
      fam = { id: r.familyId, name: r.family, variants: [], size: 0 };
      out.push(fam);
    }
    let v = fam.variants[fam.variants.length - 1];
    if (!v || v.id !== r.variantId) {
      v = { id: r.variantId, label: r.variant, rows: [] };
      fam.variants.push(v);
    }
    v.rows.push(r);
    fam.size++;
  }
  return out;
}

type Cycle = "monthly" | "annual";

/** What the buy button actually commits the user to, spelled out. */
function buyKey(plan: Plan, cycle: Cycle): "pl_buy_30" | "pl_buy_12m" {
  return cycle === "annual" && plan.annualUsdPerMonth != null ? "pl_buy_12m" : "pl_buy_30";
}

function TagChip({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  if (!plan.tag) return null;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
      style={
        plan.popular
          ? { background: "var(--color-accent)", color: "var(--color-on-accent)" }
          : // A gift tag names something given, so it takes the reward amber the
            // rest of the giving reads in rather than the neutral chip.
            plan.tag === "gift"
            ? { background: "var(--color-reward-tint)", color: "var(--color-reward)" }
            : { background: "var(--color-card2)", color: "var(--color-ink2)" }
      }
    >
      {t(TAG_KEY[plan.tag])}
    </span>
  );
}

function Estimates({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const { t, n } = useI18n();
  const [showInfo, setShowInfo] = useState(false);
  const benchmarks = buildBenchmarks();
  const cheapest = (kind: Benchmark["kind"]) =>
    benchmarks
      .filter((row) => row.kind === kind && row.coins != null && row.coins > 0)
      .reduce<Benchmark | null>((best, row) => (!best || (row.coins ?? Infinity) < (best.coins ?? Infinity) ? row : best), null);
  const imageBenchmark = cheapest("image");
  const videoBenchmark = cheapest("video");
  const audioBenchmark = cheapest("audio");
  if (!imageBenchmark && !videoBenchmark && !audioBenchmark) return null;

  const rows: { icon: typeof ImageSquare; count: number; unit: string }[] = [];
  for (const [benchmark, icon, unit] of [
    [imageBenchmark, ImageSquare, t("w_est_img")],
    [videoBenchmark, VideoCamera, t("w_est_vid")],
    [audioBenchmark, MusicNotes, t("pl_est_audio")],
  ] as const) {
    if (!benchmark) continue;
    const count = outputsPerMonth(plan, benchmark);
    if (count != null) rows.push({ icon, count, unit });
  }

  return (
    <div>
      <div className="relative mb-2 flex items-center gap-1.5">
        <p className="text-[10px] font-medium text-ink3">{t("pl_cheapest_outputs")}</p>
        <button
          type="button"
          aria-label={t("pl_estimate_info_label")}
          aria-expanded={showInfo}
          onClick={() => setShowInfo((value) => !value)}
          onBlur={() => setShowInfo(false)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink3 transition-colors hover:bg-white/5 hover:text-ink"
        >
          <Info size={13} weight="bold" />
        </button>
        {showInfo && (
          <div className="absolute end-0 top-7 z-20 w-full max-w-[230px] rounded-xl border border-line bg-card2 p-3 text-[10px] font-normal leading-relaxed text-ink2 shadow-2xl">
            {t("pl_estimate_info")}
          </div>
        )}
      </div>
      <div className="grid gap-1.5 text-ink2" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map(({ icon: Icon, count, unit }) => (
          <div key={unit} className="rounded-xl bg-black/15 px-1.5 py-2 text-center">
            <Icon size={compact ? 12 : 14} className="mx-auto text-accent" />
            <span className={`${compact ? "text-[14px]" : "text-[17px]"} mt-1 block tabular-nums font-bold text-ink`}>{n(count)}</span>
            <span className="block text-[9px]">{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Monthly ⇄ yearly switch. Yearly carries the saving so the choice is legible. */
function CycleToggle({ cycle, onChange }: { cycle: Cycle; onChange: (c: Cycle) => void }) {
  const plans = usePlanLadder();
  // Read off the ladder that is actually on screen. This was a module constant
  // computed at import time — a promise about prices made before they arrived.
  const maxSave = Math.max(0, ...plans.map(annualDiscountPct));
  const { t, n, lang } = useI18n();
  const pct = lang === "fa" ? "٪" : "%";
  return (
    <div className="mx-4 mb-5 flex rounded-full border border-line bg-card p-1">
      {(["monthly", "annual"] as const).map((c) => {
        const on = cycle === c;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-medium transition-transform active:scale-[0.98]"
            style={on ? { background: "var(--color-accent)", color: "var(--color-on-accent)" } : { color: "var(--color-ink2)" }}
          >
            {t(c === "monthly" ? "pl_monthly" : "pl_annual")}
            {c === "annual" && maxSave > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                style={on ? { background: "rgba(0,0,0,0.18)" } : { background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                {pct}
                {n(maxSave)} {t("pl_save")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The campaign strip, counted down against the campaign's own end instant.
 *
 * Renders nothing at all when the API has no campaign to report, and removes
 * itself the second the countdown reaches zero. Both matter: this strip says
 * "limited time" next to a clock, and a clock that restarts on reload — which
 * is what a hardcoded duration gives you — makes that false. The headline
 * discount and bonus are the server's numbers too, so it cannot promise a rate
 * the checkout will not honour.
 *
 * ONE ROW. It was a 203px block carrying fourteen lines — a heading, a
 * subtitle, a button and a four-cell clock — filled solid in the brand colour
 * at the top of the page, which put 21% of the first screen under lime. The
 * reference's equivalent strip is 49px and one line; its big colour fields sit
 * at 28% and 91% down the page, so the top stays dark and the product breathes.
 * Keep this to a single row: the offer, the time left, and the way in.
 */
function FestivalBanner({ onSeePlans }: { onSeePlans: () => void }) {
  const { t, n, lang } = useI18n();
  const { data: campaign } = useActiveCampaign();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!campaign) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [campaign]);

  if (!campaign) return null;
  const remaining = Math.max(0, Math.floor((campaign.endsAt - now) / 1000));
  if (remaining <= 0) return null;

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const pad = (value: number) => n(value).padStart(2, lang === "fa" ? "۰" : "0");

  return (
    <section className="plans-festival-banner relative mb-7 flex flex-wrap items-center gap-x-4 gap-y-2.5 overflow-hidden rounded-2xl px-4 py-2.5 md:px-5">
      <span className="inline-flex shrink-0 rounded-full bg-[#131507] px-2.5 py-1 text-[10px] font-bold text-accent">
        {t("pl_festival_badge")}
      </span>

      <p className="min-w-0 flex-1 text-[12.5px] font-bold leading-snug md:text-[13.5px]">
        {t("pl_festival_strip").replace("{pct}", n(campaign.maxDiscountPct)).replace("{n}", n(campaign.maxBonusCoins))}
      </p>

      {/* The clock sits on its own dark chip rather than bare on the lime. Two
          reasons, both legibility: near-black type on a saturated fill is high
          contrast but low *separation* — the digits sank into the strip — and a
          bare four-group figure like 03:02:47:25 has no reading. Clocks are
          three groups, so the days are split out and labelled and the rest
          reads as an ordinary hh:mm:ss. */}
      <span className="flex shrink-0 items-center gap-2 rounded-full bg-[#131507] px-3 py-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        {days > 0 && (
          <span className="text-[11px] font-semibold text-accent/85">
            {n(days)} {t("pl_festival_days")}
          </span>
        )}
        <span dir="ltr" className="font-display text-[14px] font-bold tabular-nums text-accent">
          {pad(hours)}:{pad(minutes)}:{pad(seconds)}
        </span>
      </span>

      <button
        onClick={onSeePlans}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#131507] px-3.5 py-1.5 text-[11.5px] font-bold text-accent transition-transform active:scale-[0.98]"
      >
        {t("pl_festival_cta")}
        <ArrowRight size={12} weight="bold" className="rtl:rotate-180" />
      </button>
    </section>
  );
}

/** Price block — the one place monthly/annual actually diverges. */
function Price({ plan, cycle, account }: { plan: Plan; cycle: Cycle; account?: PricingAccount | undefined }) {
  const { t, n, lang } = useI18n();
  const pct = lang === "fa" ? "٪" : "%";
  const annual = cycle === "annual" && plan.annualUsdPerMonth != null;
  // Every figure below goes through effectiveUsd rather than reading the plan
  // row, so a team account sees cost price everywhere at once instead of in
  // whichever spots someone remembered.
  const perMonth = effectiveUsd(plan, annual, account);
  const total = annualTotalUsd(plan, account);
  const off = annualDiscountPct(plan);
  const annualSaving = annual && total != null ? Math.max(0, effectiveUsd(plan, false, account) * 12 - total) : 0;

  return (
    <>
      {annual && off > 0 && (
        <div className="mb-1 text-[10.5px] text-ink3">
          <s>{n(toman(effectiveUsd(plan, false, account)))}</s> · {pct}
          {n(off)} {t("pl_save")}
        </div>
      )}
      {/* Number and unit on one line, the cadence on its own beneath it. Run
          together — "۸٬۳۳۰٬۰۰۰ تومان معادل ماهانه" — the figure and two
          different qualifiers read as one long string and the price stops
          being findable. And on the monthly cycle there is no "equivalent"
          about it: that wording only means something next to an annual total. */}
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[24px] font-semibold leading-none tabular-nums">{n(toman(perMonth))}</span>
        <span className="text-[11.5px] text-ink2">{t("w_toman")}</span>
      </div>
      <div className="mt-0.5 text-[10.5px] text-ink3">{t(annual ? "pl_per_month_equiv" : "pl_per_month")}</div>
      {annual && total != null && (
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink2">
          <CalendarCheck size={12} weight="fill" className="shrink-0 text-accent" />
          {t("pl_today")}: {n(toman(total))} {t("w_toman")} ({t("pl_billed_annual")})
        </div>
      )}
      {annualSaving > 0 && (
        <div className="mt-1 text-[10.5px] font-medium text-reward">{t("pl_save_amount").replace("{n}", n(toman(annualSaving)))}</div>
      )}
      {cycle === "annual" && plan.annualUsdPerMonth == null && <div className="mt-1 text-[10.5px] text-ink3">{t("pl_monthly_only")}</div>}
    </>
  );
}

function PlanFlipShell({
  plan,
  cycle,
  account,
  compact = false,
  children,
}: {
  plan: Plan;
  cycle: Cycle;
  account?: PricingAccount | undefined;
  compact?: boolean;
  children: ReactNode;
}) {
  const { t, c } = useI18n();
  const [flipped, setFlipped] = useState(false);
  const audienceKey = PLAN_AUDIENCE_KEY[plan.code as keyof typeof PLAN_AUDIENCE_KEY];
  const PlanMark = PLAN_MARK[plan.code as keyof typeof PLAN_MARK] ?? Lightning;
  // Values live in tokens.css §4c, not here — a hex typed into a screen is a
  // colour nothing else in the system can find again.
  const accents: Record<string, string> = {
    starter: "var(--vg-plan-starter)",
    basic: "var(--vg-plan-basic)",
    flow: "var(--vg-plan-flow)",
    plus: "var(--vg-plan-plus)",
    pro: "var(--vg-plan-pro)",
    studio: "var(--vg-plan-studio)",
    creator: "var(--vg-plan-creator)",
  };

  return (
    <article
      className={`plans-flip-card ${compact ? "plans-flip-card--compact" : ""}`}
      style={{ "--plan-color": accents[plan.code] ?? "var(--color-accent)" } as CSSProperties}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      <div className={`plans-flip-card__stage ${flipped ? "is-flipped" : ""}`}>
        <div className="plans-flip-card__face plans-flip-card__front" onClick={() => setFlipped(true)}>
          <div className="plans-flip-card__wash" aria-hidden />
          <div className="relative z-10 flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-[18px] font-bold tracking-wide" style={{ color: "var(--plan-color)" }}>
                {plan.name}
              </p>
              {audienceKey && <p className="mt-1 text-[11px] text-ink3">{t(audienceKey)}</p>}
            </div>
            <TagChip plan={plan} />
          </div>

          <div className="plans-flip-visual" aria-hidden>
            {VISUAL_BARS.map((width, index) => (
              <span key={width} style={{ width: `${width}%`, animationDelay: `${index * 160}ms` }} />
            ))}
            <div className="plans-flip-visual__core">
              <PlanMark size={26} weight="fill" />
            </div>
          </div>

          <div className="relative z-10 mt-auto">
            <div className="flex items-end justify-between gap-3 border-b border-line pb-4">
              <div>
                <p className="text-[10px] text-ink3">{t("pl_plan_credit")}</p>
                <p className="mt-1 font-display text-[28px] font-bold tabular-nums">
                  {c(plan.coinsPerTerm)} <span className="text-[11px] font-normal text-ink2">{t("w_coins")}</span>
                </p>
              </div>
              {plan.bonusCoins > 0 && (
                /* No leading "+". coinsPerTerm above is the total with the
                   bonus already inside it, so a plus sign invites the reader to
                   add the two together and arrive at a number nobody is
                   selling. The chip names a part of that total, not an extra. */
                <span className="rounded-full bg-reward-wash px-2.5 py-1 text-[10px] font-semibold text-reward">
                  {c(plan.bonusCoins)} {t("w_gift")}
                </span>
              )}
            </div>
            {/* The price gets the full width. It used to share a row with the
                "see details" hint, and at 207px the two could not both fit —
                the hint crushed down to 49px and the price clipped its own
                last digit. A price on a pricing card is the last thing that
                should be losing a fight for space. */}
            <div className="plans-flip-price mt-4 min-w-0 text-start">
              <Price plan={plan} cycle={cycle} account={account} />
            </div>
            <span
              className="mt-3 flex items-center justify-center gap-1.5 border-t border-line pt-2.5 text-[10.5px] font-semibold"
              style={{ color: "var(--plan-color)" }}
            >
              {t("pl_flip_details")}
              <ArrowRight size={12} className="rtl:rotate-180" />
            </span>
          </div>
        </div>

        <div className="plans-flip-card__face plans-flip-card__back">
          <div className="z-20 -mx-4 -mt-4 mb-2 flex items-center justify-between gap-2 border-b border-line bg-card/95 px-4 py-2.5 backdrop-blur">
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold" style={{ color: "var(--plan-color)" }}>
                {plan.name}
              </p>
              <p className="text-[9px] text-ink3">{t("pl_flip_back_sub")}</p>
            </div>
            <button
              type="button"
              onClick={() => setFlipped(false)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[10px] text-ink2 hover:bg-card2"
            >
              {t("pl_flip_front")}
            </button>
          </div>
          {children}
        </div>
      </div>
    </article>
  );
}

/** Big tiered plan — the money cards. */
function PlanCard({
  plan,
  cycle,
  current,
  account,
  onSelect,
}: {
  plan: Plan;
  cycle: Cycle;
  current: boolean;
  account?: PricingAccount | undefined;
  onSelect: (plan: Plan) => void;
}) {
  const { t } = useI18n();
  return (
    <PlanFlipShell plan={plan} cycle={cycle} account={account}>
      <div className="plans-flip-card__data flex flex-col gap-2">
        <div className="plans-credit-panel rounded-2xl border border-line p-2.5">
          <Estimates plan={plan} compact />
        </div>

        <PlanAccessList plan={plan} compact />

        <UnlimitedBenefit plan={plan} compact />
        <PlanFeatures plan={plan} compact />

        <div className="plans-flip-card__cta mt-auto shrink-0 border-t border-line pt-2">
          <button onClick={() => onSelect(plan)} className="plans-modern-cta w-full py-3 text-[13.5px] font-bold" disabled={current}>
            {t(current ? "pl_current" : buyKey(plan, cycle))}
          </button>
        </div>
      </div>
    </PlanFlipShell>
  );
}

/** Entry plan — compact grid cell. */
function EntryCard({
  plan,
  cycle,
  current,
  account,
  onSelect,
}: {
  plan: Plan;
  cycle: Cycle;
  current: boolean;
  account?: PricingAccount | undefined;
  onSelect: (plan: Plan) => void;
}) {
  const { t } = useI18n();
  return (
    <PlanFlipShell plan={plan} cycle={cycle} account={account} compact>
      <div className="plans-flip-card__data flex flex-col gap-2">
        <div className="plans-credit-panel rounded-xl border border-line p-2.5">
          <Estimates plan={plan} compact />
        </div>
        <PlanAccessList plan={plan} compact />
        <UnlimitedBenefit plan={plan} compact />
        <PlanFeatures plan={plan} compact />
        <button
          onClick={() => onSelect(plan)}
          className="plans-modern-cta plans-flip-card__cta mt-auto w-full shrink-0 py-2.5 text-[12px] font-bold"
          disabled={current}
        >
          {t(current ? "pl_current" : buyKey(plan, cycle))}
        </button>
      </div>
    </PlanFlipShell>
  );
}

type CheckoutState =
  | { status: "review" }
  | { status: "submitting" }
  | { status: "redirecting" }
  /** The order exists but there is no gateway to send anyone to. Not a sale. */
  | { status: "blocked"; order: CheckoutOrder }
  | { status: "failed"; message: string };

/**
 * Confirm what is about to be bought, then hand off to the gateway.
 *
 * The sheet owns the review and the handoff; it owns no pricing. Every figure
 * it shows is the same helper the cards use, and the figure that gets charged
 * is the server's own — it is told a plan and a cycle, never an amount. The
 * two can still be compared, which is the point of showing the total here.
 */
function CheckoutSheet({
  plan,
  cycle,
  account,
  onClose,
}: {
  plan: Plan;
  cycle: Cycle;
  account?: PricingAccount | undefined;
  onClose: () => void;
}) {
  const { t, n, c } = useI18n();
  const services = useAppServices();
  const annual = cycle === "annual" && plan.annualUsdPerMonth != null;
  const monthlyPrice = effectiveUsd(plan, annual, account);
  const total = annual ? annualTotalUsd(plan, account) : monthlyPrice;
  const [state, setState] = useState<CheckoutState>({ status: "review" });
  const shownAmount = toman(total ?? monthlyPrice);
  const busy = state.status === "submitting" || state.status === "redirecting";

  /**
   * Confirm, then hand off. The server prices the order and answers with the
   * gateway URL it registered — with Zibal that is the `start/{trackId}` page —
   * and the browser leaves. It is a full navigation rather than a fetch because
   * the person has to arrive at the bank on the gateway's own origin.
   *
   * When there is no gateway to go to, the sheet says so and stays where it is.
   * It deliberately does not congratulate anyone: no tick, no receipt, no
   * order number presented as proof. Nothing has been bought at that point, and
   * a sheet that looks like it has is worse than a button that does nothing.
   */
  async function confirm() {
    setState({ status: "submitting" });
    try {
      const order = await services.payment.createOrder({ planId: plan.code, cycle: annual ? "annual" : "monthly" });
      if (order.gatewayUrl) {
        setState({ status: "redirecting" });
        window.location.assign(order.gatewayUrl);
        return;
      }
      setState({ status: "blocked", order });
    } catch (error) {
      setState({ status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="presentation">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label={t("pl_checkout_close")} onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="relative z-10 w-full max-w-[480px] rounded-t-[28px] border border-line bg-card p-5 shadow-2xl md:rounded-[28px] md:p-6"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line2 md:hidden" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-ink3">DEEV</p>
            <h2 id="checkout-title" className="mt-0.5 text-[20px] font-bold">
              {t("pl_checkout_title")}
            </h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-card2" aria-label={t("pl_checkout_close")}>
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="mt-5 rounded-bezel border border-accent/40 bg-accent-soft/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] text-ink3">{t("pl_checkout_plan")}</p>
              <bdi className="mt-1 block font-display text-[22px] font-semibold text-accent">{plan.name}</bdi>
            </div>
            <div className="text-end">
              <p className="text-[11px] text-ink3">{t("pl_checkout_allowance")}</p>
              <p className="mt-1 text-[20px] font-semibold tabular-nums">
                {c(plan.coinsPerTerm)} <span className="text-[11px] font-normal text-ink2">{t("w_coins")}</span>
              </p>
            </div>
          </div>
        </div>

        <dl className="mt-4 divide-y divide-line rounded-bezel border border-line px-4">
          <div className="flex items-center justify-between py-3 text-[12.5px]">
            <dt className="text-ink2">{t("pl_checkout_cycle")}</dt>
            <dd className="font-medium">{t(annual ? "pl_checkout_annual_cycle" : "pl_checkout_monthly_cycle")}</dd>
          </div>
        </dl>

        {/* The amount is the thing this sheet exists to show, so it is the
            largest figure on it — the person is agreeing to this number before
            a gateway ever opens, not reading it back afterwards. */}
        <div className="mt-3 flex items-baseline justify-between gap-3 rounded-bezel border border-line bg-card2/60 px-4 py-3.5">
          <span className="text-[12px] text-ink2">{t("pl_checkout_due")}</span>
          <span className="font-display text-[22px] font-bold tabular-nums">
            {n(shownAmount)} <span className="text-[12px] font-normal text-ink2">{t("w_toman")}</span>
          </span>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink3">{t(annual ? "pl_checkout_annual_hint" : "pl_checkout_monthly_hint")}</p>

        <button onClick={confirm} disabled={busy} className="plans-modern-cta mt-5 w-full gap-2 py-3.5 text-[13px] font-bold">
          {busy ? (
            <>
              <CircleNotch size={15} weight="bold" className="animate-spin" />
              {t(state.status === "redirecting" ? "pl_checkout_redirecting" : "pl_checkout_submitting")}
            </>
          ) : (
            <>
              <LockKey size={15} weight="fill" />
              {t("pl_checkout_confirm")}
            </>
          )}
        </button>
        <p className="mt-2 text-center text-[10.5px] leading-relaxed text-ink3">{t("pl_checkout_gateway_note")}</p>

        {/* Reaching no gateway is a blocked step, not a completed purchase, so
            it gets a neutral notice rather than a tick and a receipt. Nothing
            here may read as "paid" — nothing has been. */}
        {state.status === "blocked" && (
          <div className="mt-4 flex gap-2.5 rounded-bezel border border-line bg-card2 p-3.5 text-start">
            <Info size={16} weight="fill" className="mt-0.5 shrink-0 text-ink3" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold">{t("pl_checkout_gateway_off")}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink2">{t("pl_checkout_gateway_off_sub")}</p>
              {/* Silent while the two figures agree. A mismatch means the price
                  this screen computed is not the price the server reserved, and
                  that has to be visible before anybody pays either of them. */}
              {state.order.amountToman !== shownAmount && (
                <p className="mt-2 text-[11px] font-semibold text-[#ff8a8a]">
                  {t("pl_checkout_amount_mismatch").replace("{n}", n(state.order.amountToman))}
                </p>
              )}
            </div>
          </div>
        )}

        {state.status === "failed" && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-[#ff8a8a]">{t("pl_checkout_failed")}</p>
        )}
      </section>
    </div>
  );
}

/* ============================================================ */
/**
 * Per-model output counts, plan by plan.
 *
 * "≈۱٬۶۷۵ تصویر یا ۱۸۶ ویدیو" is close to meaningless on a catalogue whose
 * models differ by 50x — the same coins buy 208 cheap frames or 6 Veo clips.
 * The buyer's real question is "how many of the thing I make", and only a table
 * answers it.
 *
 * Rows are priced through the same rate table the studios quote from, at a
 * stated setting printed next to the model name so the number can be checked.
 * A model whose rate has gone missing shows a dash, never an invented count.
 */
function ComparisonTable({ currentPlanId }: { currentPlanId: string | null }) {
  const { t, n, c } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const plans = usePlanLadder();

  // Every tier, cheapest first — the table scrolls, so there is no reason to
  // hide half the ladder. A comparison that omits the plan you are on is not
  // one you can act from.
  const cols = [...plans].sort((a, b) => a.coinsPerTerm - b.coinsPerTerm);
  // Built at render, not at module load: some rates arrive from the live table
  // after mount, and a list frozen at import time would quote the fallbacks
  // forever.
  const rows = useMemo(() => buildBenchmarks(), []);
  const kinds = (["video", "image", "audio"] as const).filter((k) => rows.some((b) => b.kind === k));
  const VISIBLE = 3;

  return (
    <section className="mt-12">
      <h2 className="text-[28px] font-extrabold leading-tight md:text-[36px]" style={{ fontFamily: "var(--vg-font-display)" }}>
        مقایسهٔ پلن‌ها
      </h2>
      <p className="mt-1 text-[13px] text-ink3">ببین با هر پلن دقیقاً چند تا از چه چیزی می‌سازی.</p>

      {/* No sideways scroll, at any width.
          It scrolled because the table forced 220 + 7x150 = 1270px into a
          1036px box. Three things fixed that without dropping a plan: the unit
          label moved out of all seven cells into the row label where it is said
          once, the money column came out of the header, and the widths went
          fluid. Seven plans now share whatever there is — 269 + 7x109 at 1425.

          Below `md` no arrangement of seven columns is honest, so the table is
          not shown there at all; the same data stacks instead. A comparison
          whose columns collapse into a scroll is not a comparison, but neither
          is one clipped mid-number. */}
      <div className="mt-5 hidden overflow-hidden rounded-bezel border border-line md:block">
        {/* `border-separate`, not `collapse`: a collapsed table drops the
            borders of a position:sticky cell, so the pinned model column lost
            its edges and slid under the scrolling ones. */}
        <table
          className="w-full border-separate text-start"
          // No min-width. It used to force 220 + 7x150 = 1270px into a 1036px
          // box and rely on scrolling to reach the rest, which is the thing
          // being removed: the columns now share whatever width there is.
          style={{ borderSpacing: 0, tableLayout: "fixed" }}
        >
          <thead>
            <tr>
              <th className="sticky w-[34%] p-3 align-bottom sm:w-[26%]" style={{ insetInlineStart: 0, background: "var(--color-bg)" }} />
              {cols.map((p) => {
                const lead = p.popular || p.code === currentPlanId;
                return (
                  <th key={p.code} className="px-2 py-3 align-bottom text-center">
                    <span className="flex items-center justify-center gap-1.5">
                      <bdi className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)" }}>
                        {p.name}
                      </bdi>
                      {lead && (
                        <span
                          className="rounded px-1 py-px text-[9px] font-bold"
                          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                        >
                          {p.code === currentPlanId ? t("pl_current") : "بهترین"}
                        </span>
                      )}
                    </span>
                    {/* `vg-numeric` goes on the digits ALONE — a Persian word
                        inside it inherits the numeral font and stops joining.

                        Coins per month, and no money. A price here would be the
                        third place the same figure lives, and the one nobody
                        remembers to update: the plan cards above already carry
                        the full breakdown with the cycle discount applied. This
                        table answers "how much can I make", which is a question
                        about the allowance, not the bill. */}
                    <span className="mt-1 block whitespace-nowrap text-[12px] font-normal text-ink2">
                      <span className="vg-numeric">{c(p.coinsPerTerm)}</span> سکه
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          {kinds.map((kind) => {
            const fams = byFamily(rows.filter((b) => b.kind === kind));
            const open = expanded[kind] ?? false;
            // Cut by family, never mid-family — see byFamily.
            const shown = open ? fams : fams.slice(0, VISIBLE);
            return (
              <tbody key={kind}>
                <tr>
                  <td colSpan={cols.length + 1} className="px-4 pb-1 pt-6 text-[15px] font-bold">
                    {KIND_LABEL[kind]}
                  </td>
                </tr>
                {shown.map((fam, fi) =>
                  fam.variants.map((vg, vi) =>
                    vg.rows.map((b, ri) => {
                      const firstOfFamily = vi === 0 && ri === 0;
                      const firstOfVariant = ri === 0;
                      // Heavy rule at a family, hairline at a variant, nothing
                      // between the quality steps of one variant. The grouping
                      // has to be visible or it is not grouping.
                      const rule = firstOfFamily
                        ? fi === 0
                          ? "none"
                          : "2px solid var(--color-line2)"
                        : firstOfVariant
                          ? "1px solid var(--color-line)"
                          : "none";
                      return (
                        <tr key={b.key}>
                          <td
                            className="sticky px-3 py-2 align-top"
                            style={{ insetInlineStart: 0, background: "var(--color-bg)", borderTop: rule }}
                          >
                            {/* Three levels, each said once: family, then
                                variant, then the setting. The table used to
                                repeat "Seedance · نسخه ۲" on four consecutive
                                rows that differed only in a resolution buried in
                                the small print, which is what made it look like
                                a jumble even though every row was correct. */}
                            {firstOfFamily && <bdi className="block pb-0.5 text-[13.5px] font-bold">{fam.name}</bdi>}
                            {/* A family with one variant does not get a variant
                                line: MiniMax H3's sole shape is called "H3", so
                                the label read "MiniMax H3 › H3". Say it once. */}
                            {firstOfVariant && fam.variants.length > 1 && (
                              <bdi className="block text-[12.5px] font-semibold text-ink2" style={{ paddingInlineStart: "0.6rem" }}>
                                {vg.label}
                              </bdi>
                            )}
                            {/* `at` is mixed — "720p · 5 ثانیه" — so it stays in
                                the UI font. Only the coin figure is isolated. */}
                            <span className="block text-[11px] text-ink3" style={{ paddingInlineStart: "1.2rem" }}>
                              {b.at} · <span className="vg-numeric">{n(b.coins!)}</span> سکه
                            </span>
                          </td>
                          {cols.map((p) => {
                            const v = outputsPerMonth(p, b);
                            return (
                              <td key={p.code} className="px-2 py-2 text-center align-bottom" style={{ borderTop: rule }}>
                                {v == null || v === 0 ? (
                                  // A plan whose month does not buy even one is
                                  // an ×, not a zero. Zero reads as a number you
                                  // could grow into.
                                  <X size={13} className="mx-auto text-ink3" />
                                ) : (
                                  <span className="vg-numeric text-[15px] font-semibold">{n(v)}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }),
                  ),
                )}
                {fams.length > VISIBLE && (
                  <tr>
                    <td colSpan={cols.length + 1} className="border-t border-line p-3">
                      <button
                        onClick={() => setExpanded((s) => ({ ...s, [kind]: !open }))}
                        className="flex items-center gap-1.5 text-[12.5px] text-ink2"
                      >
                        <CaretDown size={12} weight="bold" className={open ? "rotate-180" : ""} />
                        {open ? "کمتر" : `${n(fams.length - VISIBLE)} مدل دیگر`}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>

      {/* Phone: the same numbers, turned ninety degrees.
          One block per model, the plans as a grid inside it. A row of seven
          plans does not fit a 375px screen at any font size worth reading, and
          the alternative — the table with a scrollbar — hides four of them
          behind a gesture. Stacked, nothing is hidden and nothing is clipped;
          it is simply taller, which a phone already is. */}
      <div className="mt-5 flex flex-col gap-4 md:hidden">
        {kinds.map((kind) => {
          const fams = byFamily(rows.filter((b) => b.kind === kind));
          const open = expanded[kind] ?? false;
          const shown = open ? fams : fams.slice(0, VISIBLE);
          return (
            <div key={kind}>
              <p className="mb-2 text-[15px] font-bold">{KIND_LABEL[kind]}</p>
              <div className="flex flex-col gap-2">
                {/* One card per FAMILY, its variants inside — the same grouping
                    the table uses. A card per variant put four Nano Bananas in
                    four separate boxes, which is the phone version of the same
                    jumble. */}
                {shown.map((fam) => (
                  <div key={fam.id} className="rounded-bezel border border-line p-3">
                    <bdi className="block text-[13.5px] font-bold">{fam.name}</bdi>
                    {/* Same three levels as the table: family, variant, setting. */}
                    <div className="mt-2 flex flex-col gap-4">
                      {fam.variants.map((vg) => (
                        <div key={vg.id}>
                          {fam.variants.length > 1 && <bdi className="block text-[12.5px] font-semibold text-ink2">{vg.label}</bdi>}
                          {vg.rows.map((b) => (
                            <div key={b.key} className="mt-1.5">
                              <p className="text-[11px] text-ink3">
                                {b.at} · <span className="vg-numeric">{n(b.coins!)}</span> سکه
                              </p>
                              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {cols.map((p) => {
                                  const v = outputsPerMonth(p, b);
                                  const lead = p.popular || p.code === currentPlanId;
                                  return (
                                    <div key={p.code} className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5">
                                      <bdi
                                        className="truncate text-[11.5px]"
                                        style={{ color: lead ? "var(--color-accent)" : "var(--color-ink2)" }}
                                      >
                                        {p.name}
                                      </bdi>
                                      {v == null || v === 0 ? (
                                        <X size={11} className="shrink-0 text-ink3" />
                                      ) : (
                                        <span className="vg-numeric shrink-0 text-[14px] font-semibold">{n(v)}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {fams.length > VISIBLE && (
                <button
                  onClick={() => setExpanded((s) => ({ ...s, [kind]: !open }))}
                  className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink2"
                >
                  <CaretDown size={12} weight="bold" className={open ? "rotate-180" : ""} />
                  {open ? "کمتر" : `${n(fams.length - VISIBLE)} مدل دیگر`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink3">
        اعداد سقف‌اند: سکه‌ها بین مدل‌ها مشترک‌اند، پس اگر از چند مدل استفاده کنی تعدادها بین‌شان تقسیم می‌شود.
        {" ترکیبی که پرووایدر نمی‌فروشد در جدول نمی‌آید."}
      </p>
    </section>
  );
}

export default function Plans({
  wallet,
  account,
  currentPlanId = null,
  onBack,
}: {
  wallet: Wallet;
  /** Drives cost-price display for flagged team accounts. */
  account?: PricingAccount | undefined;
  /** null until the backend can tell us — do NOT fake an active plan here. */
  currentPlanId?: string | null;
  onBack: () => void;
}) {
  const { t, c, lang } = useI18n();
  const plans = usePlanLadder();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  // Switching cycle re-lays out the cards, and an RTL snap container anchors to
  // the far end when its content resizes — which dumped the user on the most
  // expensive plan instead of the recommended one. Send it back to the start.
  const carRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    carRef.current?.scrollTo({ left: 0 });
  }, [cycle]);

  const current = plans.find((p) => p.code === currentPlanId) ?? null;
  const main = plans.filter((p) => p.group === "main");
  const entry = plans.filter((p) => p.group === "entry");

  // The date that matters is the next grant to expire, not "when the plan ends".
  // A user can hold a plan bucket and a gift bucket at once, and the gift almost
  // always burns first — which is the thing worth telling them about.
  const nextExpiry = wallet.nextExpiry;
  const expiryLabel =
    nextExpiry != null
      ? new Date(nextExpiry.at).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { day: "numeric", month: "long" })
      : null;

  return (
    /* The screen was built inside the old 480px phone column and never left it:
       every child pinned itself with `px-4` and the plan row was a snap
       carousel at any width, so a 1440px window got a phone strip down the
       middle. It now runs in a 1100px container, and the two rows that were
       carousels become grids from `md`. */
    <div className="plans-art-page relative z-10 mx-auto min-h-[100dvh] w-full max-w-[1100px] px-4 pb-10 pt-4 md:px-8">
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label={t("nav_home")}
          className="grid h-10 w-10 place-items-center rounded-full bg-card2 active:scale-95"
        >
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{t("pl_title")}</div>
      </div>

      <FestivalBanner onSeePlans={() => document.getElementById("plan-cards")?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      <section className="mb-7 px-1 py-2 text-center">
        <p className="text-[11px] font-semibold text-accent">{t("pl_hero_eyebrow")}</p>
        <h1 className="plans-reference-title mx-auto mt-2 max-w-[760px] font-display text-[30px] font-extrabold leading-[1.3] md:text-[42px]">
          {t("pl_hero_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-[650px] text-[12.5px] leading-7 text-ink2 md:text-[14px]">{t("pl_hero_sub")}</p>
        <div className="mx-auto mt-5 flex max-w-[850px] flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-ink2">
          {["pl_benefit_models", "pl_benefit_payment", "pl_benefit_training", "pl_benefit_support", "pl_benefit_shared"].map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <CheckCircle size={12} weight="fill" className="text-accent" />
              {t(key as "pl_benefit_models")}
            </span>
          ))}
        </div>
      </section>

      {/* Balance and the not-subscribed notice sit side by side once there is
          room — they are two halves of the same "where you stand" statement. */}
      <div className="mb-6 grid gap-3 md:grid-cols-2 md:items-stretch">
        <div className="rounded-bezel border border-line bg-card px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink3">{current ? t("pl_this_month") : t("w_balance")}</span>
            <span className="flex items-center gap-2">
              <CoinMark size={17} className="text-ink2" />
              <span className="text-[24px] font-semibold tabular-nums">{c(wallet.spendable)}</span>
              <span className="text-[13px] text-ink2">{t("w_coins")}</span>
            </span>
          </div>
          {(current || expiryLabel) && (
            <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5 text-[11px] text-ink2">
              <span className="flex items-center gap-1.5">
                {current && <CheckCircle size={12} weight="fill" className="text-accent" />}
                {current?.name}
              </span>
              {expiryLabel && (
                <span className="flex items-center gap-1.5">
                  <CalendarCheck size={12} weight="fill" className="text-accent" />
                  {t("pl_expires")}: {expiryLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {/* not-subscribed state — the reason this screen exists for a new user */}
        {!current && (
          <div className="flex items-start gap-3 rounded-bezel border border-line2 bg-card2/70 px-4 py-3.5">
            <span
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent"
              style={{ background: "var(--color-accent-soft)" }}
            >
              <Sparkle size={15} weight="fill" />
            </span>
            <div>
              <div className="text-[13.5px] font-medium">{t("pl_no_plan_title")}</div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink3">{t("pl_no_plan_sub")}</p>
            </div>
          </div>
        )}
      </div>

      <CycleToggle cycle={cycle} onChange={setCycle} />

      {/* Main plans. A snap carousel on a phone, where three cards cannot sit
          side by side; a plain grid from `md`, where they can and where a
          horizontal scroll hides two thirds of the catalogue behind a gesture
          nobody makes with a mouse. */}
      <div id="plan-cards" className="mb-2.5 flex scroll-mt-5 items-center gap-1.5 text-[12.5px] text-ink2">
        <Lightning size={14} weight="fill" className="text-accent" />
        {t("pl_main_group")}
      </div>
      <div
        ref={carRef}
        className="no-scrollbar mb-7 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible"
      >
        {main.map((p) => (
          <PlanCard key={p.code} plan={p} cycle={cycle} current={p.code === currentPlanId} account={account} onSelect={setSelectedPlan} />
        ))}
      </div>

      <div className="mb-2.5 text-[12.5px] text-ink2">{t("pl_entry_group")}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {entry.map((p) => (
          <EntryCard key={p.code} plan={p} cycle={cycle} current={p.code === currentPlanId} account={account} onSelect={setSelectedPlan} />
        ))}
      </div>

      <ComparisonTable currentPlanId={currentPlanId} />

      {selectedPlan && <CheckoutSheet plan={selectedPlan} cycle={cycle} account={account} onClose={() => setSelectedPlan(null)} />}
    </div>
  );
}
