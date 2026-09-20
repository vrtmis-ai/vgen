/* ---------------------------------------------------------------------------
   The plan card, and everything printed on it.

   It lived inside the plans screen, and the landing page had a second set of
   cards of its own — its own tag chip, its own estimates, its own price block —
   which is two answers to "what does this plan give me" for one plan. They had
   already drifted: the landing's cards were flat, the screen's flip to their
   details, and a visitor comparing the front page against /plans was reading
   two designs of the same thing.

   One card now, rendered in both places. The screen passes the account so the
   price can be personal; the landing passes none, because nobody is signed in
   when it is read.
   --------------------------------------------------------------------------- */
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  Crown,
  Feather,
  FilmSlate,
  ImageSquare,
  Info,
  Leaf,
  Lightning,
  MusicNotes,
  PaintBrush,
  Palette,
  Sparkle,
  VideoCamera,
  XCircle,
} from "@phosphor-icons/react";
import {
  toman,
  annualDiscountPct,
  annualTotalUsd,
  effectiveUsd,
  buildBenchmarks,
  outputsPerMonth,
  type Benchmark,
  type Plan,
  type PricingAccount,
} from "../data/plans";
import { useI18n } from "../lib/i18n";
import { unlimitedModelNames } from "../lib/unlimitedModels";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";
import { useTomanPerUsd } from "../features/plans/PlansProvider";

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

function PlanFeatures({ compact = false }: { compact?: boolean }) {
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
      {/* One sentence for every card. It used to be three, one per tier, and
          they were the ladder's whole pitch — the cheap plan got "economy
          models", the top one "full access". No model is locked to a plan any
          more, so all three of those sentences became the same fact. */}
      <p className={`${compact ? "mt-2 text-[9px]" : "mt-2.5 text-[10px]"} leading-relaxed text-ink3`}>{t("pl_models_all")}</p>
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
  const { t, lang } = useI18n();
  const families = useCatalogFamilies();
  // The window, not the tier: a plan that carries no days of it has no benefit
  // to show, which is every pack.
  if (plan.unlimitedDays <= 0) return null;
  const isProTrial = plan.unlimitedDays < 30;
  /* The models come from the catalogue. This sentence used to name two of them
     as a literal string, and once a third gained the pipe it was quietly wrong
     — on the page whose whole job is saying what somebody is buying.

     `Intl.ListFormat` rather than joining on "،": Persian and English put the
     last separator in different places, and a hand-rolled join gets one of them
     wrong. */
  const models = new Intl.ListFormat(lang === "fa" ? "fa-IR" : "en-US", { style: "long", type: "conjunction" }).format(
    unlimitedModelNames(families),
  );
  return (
    <div className={`rounded-xl border border-reward-line bg-reward-wash ${compact ? "p-2" : "p-3"}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold text-reward">
        <Sparkle size={13} weight="fill" />
        {t(isProTrial ? "pl_unlimited_7d_title" : "pl_unlimited_title")}
      </div>
      <p className={`${compact ? "mt-1" : "mt-1.5"} text-[10px] leading-relaxed text-ink2`}>
        {(isProTrial ? t("pl_unlimited_7d_sub") : t("pl_unlimited_sub")).replace("{models}", models)}
      </p>
    </div>
  );
}

function PlanAccessList({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const { t, n } = useI18n();
  /* Two rows went: "advanced models" and "flagship models", ticked on the
     dearer plans and struck through on the cheap ones. They were the ladder's
     main claim and they are not true any more — every plan reaches every
     model. What a plan sells is coins, how long they last, how many
     generations run at once, and the unlimited window. */
  const rows = [
    { key: "tools", active: true, label: t("pl_all_studios") },
    { key: "models", active: true, label: t("pl_access_all_models") },
    {
      key: "coins",
      active: true,
      // The difference a pack is bought for, said on the card that is one.
      label: plan.termDays === 0 ? t("pl_access_coins_forever") : t("pl_access_coins_term").replace("{n}", n(plan.termDays)),
    },
    {
      key: "unlimited",
      active: plan.unlimitedDays > 0,
      label: plan.unlimitedDays > 0 ? t("pl_access_unlimited_days").replace("{n}", n(plan.unlimitedDays)) : t("pl_access_unlimited"),
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

export type Cycle = "monthly" | "annual";

/** What the buy button actually commits the user to, spelled out. */
function buyKey(plan: Plan, cycle: Cycle): "pl_buy_30" | "pl_buy_12m" | "pl_buy_pack" {
  // A pack buys coins, not days. Saying "30 days" on it would name the one
  // thing about it that is not true.
  if (plan.termDays === 0) return "pl_buy_pack";
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

/** Price block — the one place monthly/annual actually diverges. */
function Price({ plan, cycle, account }: { plan: Plan; cycle: Cycle; account?: PricingAccount | undefined }) {
  const rate = useTomanPerUsd();
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
          <s>{n(toman(effectiveUsd(plan, false, account), rate))}</s> · {pct}
          {n(off)} {t("pl_save")}
        </div>
      )}
      {/* Number and unit on one line, the cadence on its own beneath it. Run
          together — "۸٬۳۳۰٬۰۰۰ تومان معادل ماهانه" — the figure and two
          different qualifiers read as one long string and the price stops
          being findable. And on the monthly cycle there is no "equivalent"
          about it: that wording only means something next to an annual total. */}
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[24px] font-semibold leading-none tabular-nums">{n(toman(perMonth, rate))}</span>
        <span className="text-[11.5px] text-ink2">{t("w_toman")}</span>
      </div>
      {/* A pack is bought once, so there is no cadence to state: "در ماه"
          under a price that recurs nowhere is the card promising a
          subscription this plan stopped being. */}
      <div className="mt-0.5 text-[10.5px] text-ink3">
        {plan.termDays === 0 ? t("pl_one_off") : t(annual ? "pl_per_month_equiv" : "pl_per_month")}
      </div>
      {annual && total != null && (
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink2">
          <CalendarCheck size={12} weight="fill" className="shrink-0 text-accent" />
          {t("pl_today")}: {n(toman(total, rate))} {t("w_toman")} ({t("pl_billed_annual")})
        </div>
      )}
      {annualSaving > 0 && (
        <div className="mt-1 text-[10.5px] font-medium text-reward">{t("pl_save_amount").replace("{n}", n(toman(annualSaving, rate)))}</div>
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
      // Named per plan, so a test can hold one card rather than a whole grid.
      data-testid={`plan-card-${plan.code}`}
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
export function PlanCard({
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
        <PlanFeatures compact />

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
export function EntryCard({
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
        <PlanFeatures compact />
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
