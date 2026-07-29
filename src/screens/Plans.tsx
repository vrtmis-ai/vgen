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
  estImages,
  estVideos,
  type Plan,
} from "../data/plans";
import { useI18n } from "../lib/i18n";

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
  return (
    <div className={`flex items-center gap-3 ${compact ? "text-[11px]" : "text-[12px]"} text-ink2`}>
      <span className="flex items-center gap-1">
        <ImageSquare size={compact ? 12 : 14} className="text-accent" />
        {t("w_about")}
        {n(estImages(plan))} {t("w_est_img")}
      </span>
      <span className="text-ink3">{t("w_est_or")}</span>
      <span className="flex items-center gap-1">
        <VideoCamera size={compact ? 12 : 14} className="text-accent" />
        {t("w_about")}
        {n(estVideos(plan))} {t("w_est_vid")}
      </span>
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
function Price({ plan, cycle }: { plan: Plan; cycle: Cycle }) {
  const { t, n, lang } = useI18n();
  const pct = lang === "fa" ? "٪" : "%";
  const annual = cycle === "annual" && plan.annualUsdPerMonth != null;
  const perMonth = annual ? plan.annualUsdPerMonth! : plan.monthlyUsd;
  const total = annualTotalUsd(plan);
  const off = annualDiscountPct(plan);

  return (
    <>
      {annual && off > 0 && (
        <div className="mb-1 text-[10.5px] text-ink3">
          <s>{n(toman(plan.monthlyUsd))}</s> · {pct}
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
function PlanCard({ plan, cycle, current }: { plan: Plan; cycle: Cycle; current: boolean }) {
  const { t, n } = useI18n();
  return (
    <div
      className="flex w-[82%] shrink-0 snap-center flex-col gap-3.5 rounded-bezel border bg-card p-4"
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
        <Price plan={plan} cycle={cycle} />
        <button className="btn-accent mt-3 flex w-full items-center justify-center rounded-2xl py-3 text-[13.5px] font-bold" disabled={current}>
          {t(current ? "pl_current" : buyKey(plan, cycle))}
        </button>
      </div>
    </div>
  );
}

/** Entry plan — compact grid cell. */
function EntryCard({ plan, cycle, current }: { plan: Plan; cycle: Cycle; current: boolean }) {
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
        <Price plan={plan} cycle={cycle} />
      </div>
      <button className="btn-accent mt-1 flex items-center justify-center rounded-xl py-2 text-[12px] font-bold" disabled={current}>
        {t(current ? "pl_current" : buyKey(plan, cycle))}
      </button>
    </div>
  );
}

/* ============================================================ */
export default function Plans({
  coins,
  currentPlanId = null,
  expiresAt = null,
  onBack,
}: {
  coins: number;
  /** null until the backend can tell us — do NOT fake an active plan here. */
  currentPlanId?: string | null;
  /** epoch ms when the active plan runs out; null when there is no plan. */
  expiresAt?: number | null;
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

  const expiryLabel =
    expiresAt != null ? new Date(expiresAt).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { day: "numeric", month: "long" }) : null;

  return (
    <div className="relative z-10 min-h-[100dvh] pt-4 pb-10">
      <div className="mb-5 flex items-center gap-3 px-4">
        <button onClick={onBack} aria-label={t("nav_home")} className="grid h-10 w-10 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{t("pl_title")}</div>
      </div>

      {/* balance — this month's spendable coins */}
      <div className="mb-4 rounded-bezel border border-line bg-card px-5 py-4 mx-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink3">{current ? t("pl_this_month") : t("w_balance")}</span>
          <span className="flex items-center gap-2">
            <span className="text-[17px] text-ink2">⬡</span>
            <span className="text-[24px] font-semibold tabular-nums">{n(coins)}</span>
            <span className="text-[13px] text-ink2">{t("w_coins")}</span>
          </span>
        </div>
        {current && (
          <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5 text-[11px] text-ink2">
            <span className="flex items-center gap-1.5">
              <CheckCircle size={12} weight="fill" className="text-accent" />
              {current.name}
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
        <div className="mb-6 flex items-start gap-3 rounded-bezel border border-line2 bg-card2/70 px-4 py-3.5 mx-4">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent" style={{ background: "var(--color-accent-soft)" }}>
            <Sparkle size={15} weight="fill" />
          </span>
          <div>
            <div className="text-[13.5px] font-medium">{t("pl_no_plan_title")}</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink3">{t("pl_no_plan_sub")}</p>
          </div>
        </div>
      )}

      <CycleToggle cycle={cycle} onChange={setCycle} />

      {/* main plans — snap carousel keeps all three discoverable */}
      <div className="mb-2.5 flex items-center gap-1.5 px-4 text-[12.5px] text-ink2">
        <Lightning size={14} weight="fill" className="text-accent" />
        {t("pl_main_group")}
      </div>
      <div ref={carRef} className="mb-7 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
        {main.map((p) => (
          <PlanCard key={p.id} plan={p} cycle={cycle} current={p.id === currentPlanId} />
        ))}
      </div>

      {/* entry plans — one glance, no burying */}
      <div className="mb-2.5 px-4 text-[12.5px] text-ink2">{t("pl_entry_group")}</div>
      <div className="grid grid-cols-2 gap-3 px-4">
        {entry.map((p) => (
          <EntryCard key={p.id} plan={p} cycle={cycle} current={p.id === currentPlanId} />
        ))}
      </div>

      {/* Owner trimmed this to the expiry line alone. The "no auto-renewal" fact
          it used to spell out now lives in the button itself — "خرید ۳۰ روزه"
          says the same thing without a paragraph of fine print. */}
      <p className="mt-6 px-4 text-center text-[11px] leading-relaxed text-ink3">{t("pl_expiry_note")}</p>
    </div>
  );
}
