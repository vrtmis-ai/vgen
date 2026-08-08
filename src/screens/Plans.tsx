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
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarCheck, CheckCircle, Gift, ImageSquare, Lightning, Sparkle, VideoCamera } from "@phosphor-icons/react";
import {
  PLANS,
  toman,
  monthlyCoins,
  annualDiscountPct,
  annualTotalUsd,
  effectiveUsd,
  estImages,
  estVideos,
  BENCHMARKS,
  outputsPerMonth,
  type Plan,
  type PricingAccount,
} from "../data/plans";
import { CoinMark } from "../components/chrome";
import { useI18n } from "../lib/i18n";
import type { Wallet } from "../data/wallet";

const TAG_KEY = { test: "w_tag_test", gift: "w_tag_gift", popular: "w_tag_popular", best: "w_tag_best" } as const;

type Cycle = "monthly" | "annual";

/** Best annual saving across the catalogue — the number worth putting on the toggle. */
const MAX_ANNUAL_SAVE = Math.max(...PLANS.map(annualDiscountPct));

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
          : { background: "var(--color-card2)", color: "var(--color-ink2)" }
      }
    >
      {t(TAG_KEY[plan.tag])}
    </span>
  );
}

function Estimates({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const { t, n } = useI18n();
  const images = estImages(plan);
  const videos = estVideos(plan);
  // Null means the anchor model lost its rate row. Drop that half of the line
  // rather than printing a figure derived from nothing — and if both are gone,
  // there is nothing honest left to say here.
  if (images == null && videos == null) return null;
  return (
    <div className={`flex items-center gap-3 ${compact ? "text-[11px]" : "text-[12px]"} text-ink2`}>
      {images != null && (
        <span className="flex items-center gap-1">
          <ImageSquare size={compact ? 12 : 14} className="text-accent" />
          {t("w_about")}
          {n(images)} {t("w_est_img")}
        </span>
      )}
      {images != null && videos != null && <span className="text-ink3">{t("w_est_or")}</span>}
      {videos != null && (
        <span className="flex items-center gap-1">
          <VideoCamera size={compact ? 12 : 14} className="text-accent" />
          {t("w_about")}
          {n(videos)} {t("w_est_vid")}
        </span>
      )}
    </div>
  );
}

/** Monthly ⇄ yearly switch. Yearly carries the saving so the choice is legible. */
function CycleToggle({ cycle, onChange }: { cycle: Cycle; onChange: (c: Cycle) => void }) {
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
            {c === "annual" && MAX_ANNUAL_SAVE > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                style={on ? { background: "rgba(0,0,0,0.18)" } : { background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                {pct}
                {n(MAX_ANNUAL_SAVE)} {t("pl_save")}
              </span>
            )}
          </button>
        );
      })}
    </div>
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

  return (
    <>
      {annual && off > 0 && (
        <div className="mb-1 text-[10.5px] text-ink3">
          <s>{n(toman(effectiveUsd(plan, false, account)))}</s> · {pct}
          {n(off)} {t("pl_save")}
        </div>
      )}
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-[22px] font-semibold leading-none tabular-nums">{n(toman(perMonth))}</span>
        <span className="text-[11px] text-ink2">
          {t("w_toman")} {t("pl_per_month")}
        </span>
      </div>
      {annual && total != null && (
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink2">
          <CalendarCheck size={12} weight="fill" className="shrink-0 text-accent" />
          {t("pl_today")}: {n(toman(total))} {t("w_toman")} ({t("pl_billed_annual")})
        </div>
      )}
      {cycle === "annual" && plan.annualUsdPerMonth == null && (
        <div className="mt-1 text-[10.5px] text-ink3">{t("pl_monthly_only")}</div>
      )}
    </>
  );
}

/** Big tiered plan — the money cards. */
function PlanCard({
  plan,
  cycle,
  current,
  account,
}: {
  plan: Plan;
  cycle: Cycle;
  current: boolean;
  account?: PricingAccount | undefined;
}) {
  const { t, n } = useI18n();
  return (
    <div
      /* 82% of the viewport is a phone affordance — it leaves the next card
         peeking so the row reads as scrollable. Above `md` the row becomes a
         grid, so the card must stop being sized against the viewport. */
      className="flex w-[82%] shrink-0 snap-center flex-col gap-3.5 rounded-bezel border bg-card p-4 md:w-auto"
      style={{ borderColor: current ? "var(--color-accent)" : plan.popular ? "var(--color-accent)" : "var(--color-line)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px] font-semibold tracking-wide text-accent">{plan.name}</span>
        {current ? (
          <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[10px] font-medium text-accent">
            <CheckCircle size={11} weight="fill" />
            {t("pl_current")}
          </span>
        ) : (
          <TagChip plan={plan} />
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[30px] font-semibold leading-none tabular-nums">{n(monthlyCoins(plan))}</span>
          <span className="text-[13px] text-ink2">{t("pl_coins_month")}</span>
        </div>
        {plan.bonus > 0 && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
            <Gift size={12} weight="fill" />
            {n(plan.bonus)} {t("w_gift")}
          </div>
        )}
      </div>

      <Estimates plan={plan} />

      <div className="border-t border-line pt-3">
        <Price plan={plan} cycle={cycle} account={account} />
        {/* Only the recommended plan gets the accent fill. Seven filled buttons
            on one screen is the system's own "if two things are orange, one of
            them is wrong" — and on a pricing table it also throws away the one
            job the colour can do here, which is point at a plan. */}
        <button
          className={`${plan.popular || current ? "btn-accent" : "btn-quiet"} mt-3 flex w-full items-center justify-center rounded-2xl py-3 text-[13.5px] font-bold`}
          disabled={current}
        >
          {t(current ? "pl_current" : buyKey(plan, cycle))}
        </button>
      </div>
    </div>
  );
}

/** Entry plan — compact grid cell. */
function EntryCard({
  plan,
  cycle,
  current,
  account,
}: {
  plan: Plan;
  cycle: Cycle;
  current: boolean;
  account?: PricingAccount | undefined;
}) {
  const { t, n } = useI18n();
  return (
    <div
      className="relative flex flex-col gap-2 rounded-card border bg-card p-3.5"
      style={{ borderColor: current ? "var(--color-accent)" : "var(--color-line)" }}
    >
      {plan.tag && !current && (
        <span className="absolute -top-2 start-3">
          <TagChip plan={plan} />
        </span>
      )}
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[12.5px] font-semibold tracking-wide text-accent">{plan.name}</span>
        <span className="flex items-baseline gap-1">
          <span className="text-[19px] font-semibold tabular-nums">{n(monthlyCoins(plan))}</span>
          <span className="text-[11px] text-ink2">{t("w_coins")}</span>
        </span>
      </div>
      <Estimates plan={plan} compact />
      <div className="mt-0.5">
        <Price plan={plan} cycle={cycle} account={account} />
      </div>
      {/* Entry plans are never the recommendation, so they are never filled. */}
      <button
        className={`${current ? "btn-accent" : "btn-quiet"} mt-1 flex items-center justify-center rounded-xl py-2 text-[12px] font-bold`}
        disabled={current}
      >
        {t(current ? "pl_current" : buyKey(plan, cycle))}
      </button>
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
function ComparisonTable({ cycle, currentPlanId }: { cycle: Cycle; currentPlanId: string | null }) {
  const { n } = useI18n();
  const cols = PLANS.filter((p) => p.group === "main");
  const rows = BENCHMARKS.filter((b) => b.coins != null);
  const missing = BENCHMARKS.length - rows.length;

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold">با هر پلن چقدر می‌سازی</h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">
        تعداد خروجی در ماه، با تنظیماتی که کنار اسم هر مدل نوشته شده. همان قیمتی که موقع ساخت روی دکمه می‌بینی.
      </p>

      {/* The table scrolls sideways rather than collapsing: a comparison whose
          columns stack is no longer a comparison. */}
      <div className="hide-scrollbar mt-3 overflow-x-auto rounded-bezel border border-line">
        <table className="w-full min-w-[520px] border-collapse text-start">
          <thead>
            <tr style={{ background: "var(--color-card2)" }}>
              <th className="px-3 py-2.5 text-start text-[11.5px] font-medium text-ink3">مدل</th>
              {cols.map((p) => (
                <th
                  key={p.id}
                  className="px-3 py-2.5 text-center text-[12px] font-semibold"
                  style={{ color: p.popular || p.id === currentPlanId ? "var(--vg-primary-soft)" : "var(--color-ink)" }}
                >
                  <bdi>{p.name}</bdi>
                  <span className="mt-0.5 block vg-numeric text-[10.5px] font-normal text-ink3">
                    {n(monthlyCoins(p))} سکه
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.key} className="border-t border-line">
                <td className="px-3 py-2.5">
                  <bdi className="text-[12.5px]">{b.label}</bdi>
                  <span className="mt-0.5 block text-[10.5px] text-ink3">{b.at}</span>
                </td>
                {cols.map((p) => {
                  const v = outputsPerMonth(p, b);
                  return (
                    <td key={p.id} className="px-3 py-2.5 text-center">
                      <span className="vg-numeric text-[13.5px] font-semibold">{v == null ? "—" : n(v)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink3">
        اعداد سقف‌اند: سکه‌ها بین مدل‌ها مشترک‌اند، پس اگر از چند مدل استفاده کنی تعدادها بین‌شان تقسیم می‌شود.
        {cycle === "annual" && " سکه‌ی ماهانه‌ی پلن سالانه همان مقدار است؛ فقط قیمتش کمتر می‌شود."}
        {missing > 0 && ` ${n(missing)} مدل فعلاً قیمت زنده ندارد و در جدول نیامده.`}
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
  const { t, n, lang } = useI18n();
  const [cycle, setCycle] = useState<Cycle>("monthly");

  // Switching cycle re-lays out the cards, and an RTL snap container anchors to
  // the far end when its content resizes — which dumped the user on the most
  // expensive plan instead of the recommended one. Send it back to the start.
  const carRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    carRef.current?.scrollTo({ left: 0 });
  }, [cycle]);

  const current = PLANS.find((p) => p.id === currentPlanId) ?? null;
  const main = PLANS.filter((p) => p.group === "main");
  const entry = PLANS.filter((p) => p.group === "entry");

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
    <div className="relative z-10 mx-auto min-h-[100dvh] w-full max-w-[1100px] px-4 pb-10 pt-4 md:px-8">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onBack} aria-label={t("nav_home")} className="grid h-10 w-10 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{t("pl_title")}</div>
      </div>

      {/* Balance and the not-subscribed notice sit side by side once there is
          room — they are two halves of the same "where you stand" statement. */}
      <div className="mb-6 grid gap-3 md:grid-cols-2 md:items-stretch">
      <div className="rounded-bezel border border-line bg-card px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink3">{current ? t("pl_this_month") : t("w_balance")}</span>
          <span className="flex items-center gap-2">
            <CoinMark size={17} className="text-ink2" />
            <span className="text-[24px] font-semibold tabular-nums">{n(wallet.spendable)}</span>
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
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent" style={{ background: "var(--color-accent-soft)" }}>
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
      <div className="mb-2.5 flex items-center gap-1.5 text-[12.5px] text-ink2">
        <Lightning size={14} weight="fill" className="text-accent" />
        {t("pl_main_group")}
      </div>
      <div
        ref={carRef}
        className="no-scrollbar mb-7 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible"
      >
        {main.map((p) => (
          <PlanCard key={p.id} plan={p} cycle={cycle} current={p.id === currentPlanId} account={account} />
        ))}
      </div>

      <div className="mb-2.5 text-[12.5px] text-ink2">{t("pl_entry_group")}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {entry.map((p) => (
          <EntryCard key={p.id} plan={p} cycle={cycle} current={p.id === currentPlanId} account={account} />
        ))}
      </div>

      <ComparisonTable cycle={cycle} currentPlanId={currentPlanId} />

      {/* Owner trimmed this to the expiry line alone. The "no auto-renewal" fact
          it used to spell out now lives in the button itself — "خرید ۳۰ روزه"
          says the same thing without a paragraph of fine print. */}
      <p className="mt-6 text-center text-[11px] leading-relaxed text-ink3">{t("pl_expiry_note")}</p>
    </div>
  );
}
