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
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarCheck, CaretDown, CheckCircle, Gift, ImageSquare, Lightning, Sparkle, VideoCamera, X } from "@phosphor-icons/react";
import {
  PLANS,
  toman,
  monthlyCoins,
  annualDiscountPct,
  annualTotalUsd,
  effectiveUsd,
  estImages,
  estVideos,
  IMAGE_ANCHOR_NAME,
  VIDEO_ANCHOR_NAME,
  buildBenchmarks,
  outputsPerMonth,
  UNIT_LABEL,
  KIND_LABEL,
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
  // Named, and stacked rather than strung across one line — the way theirs
  // reads. "≈۱٬۶۷۵ تصویر" is a number you have to take on faith; "۱٬۶۷۵ تصویر
  // با GPT Image" is one you can go and check against the studio. On a catalog
  // whose models differ by 50x that distinction is the whole value of the line.
  //
  // The model name is Latin inside an RTL sentence, so it needs `bdi` or the
  // digits either side of it reorder around the wrong edge.
  const rows: { icon: typeof ImageSquare; count: number; unit: string; model: string | null }[] = [];
  if (images != null) rows.push({ icon: ImageSquare, count: images, unit: t("w_est_img"), model: IMAGE_ANCHOR_NAME });
  if (videos != null) rows.push({ icon: VideoCamera, count: videos, unit: t("w_est_vid"), model: VIDEO_ANCHOR_NAME });

  return (
    <div className={`flex flex-col gap-1 ${compact ? "text-[11px]" : "text-[12px]"} text-ink2`}>
      {rows.map(({ icon: Icon, count, unit, model }) => (
        <span key={unit} className="flex items-center gap-1.5">
          <Icon size={compact ? 12 : 14} className="shrink-0 text-accent" />
          <span className="tabular-nums font-semibold text-ink">{n(count)}</span>
          {unit}
          {model && (
            <span className="truncate text-ink3">
              {t("w_est_with")} <bdi>{model}</bdi>
            </span>
          )}
        </span>
      ))}
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
  const { t, n } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Every tier, cheapest first — the table scrolls, so there is no reason to
  // hide half the ladder. A comparison that omits the plan you are on is not
  // one you can act from.
  const cols = [...PLANS].sort((a, b) => monthlyCoins(a) - monthlyCoins(b));
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
                const lead = p.popular || p.id === currentPlanId;
                return (
                  <th key={p.id} className="px-2 py-3 align-bottom text-center">
                    <span className="flex items-center justify-center gap-1.5">
                      <bdi className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)" }}>
                        {p.name}
                      </bdi>
                      {lead && (
                        <span
                          className="rounded px-1 py-px text-[9px] font-bold"
                          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
                        >
                          {p.id === currentPlanId ? t("pl_current") : "بهترین"}
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
                      <span className="vg-numeric">{n(monthlyCoins(p))}</span> سکه
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          {kinds.map((kind) => {
            const group = rows.filter((b) => b.kind === kind);
            const open = expanded[kind] ?? false;
            const shown = open ? group : group.slice(0, VISIBLE);
            return (
              <tbody key={kind}>
                <tr>
                  <td colSpan={cols.length + 1} className="px-4 pb-1 pt-6 text-[15px] font-bold">
                    {KIND_LABEL[kind]}
                  </td>
                </tr>
                {shown.map((b) => (
                  <tr key={b.key}>
                    <td className="sticky border-t border-line p-3 align-top" style={{ insetInlineStart: 0, background: "var(--color-bg)" }}>
                      {/* Dotted underline, as the reference marks a term that
                          carries detail — here the detail is the setting. */}
                      <span className="text-[13px]" style={{ textDecoration: "underline dotted var(--color-line2)", textUnderlineOffset: "3px" }}>
                        <bdi>{b.family}</bdi>
                        <span className="text-ink2"> · </span>
                        <bdi className="text-ink2">{b.variant}</bdi>
                      </span>
                      {/* The unit price belongs under the label, not in a column
                          of its own where it competes with the plans. It is also
                          what explains three image rows sharing a figure. */}
                      {/* `at` is mixed — "720p · 5 ثانیه" — so it stays in the
                          UI font. Only the coin figure is isolated numerals. */}
                      {/* The unit moves here, where it is said once. It was
                          printed inside all seven cells, and being constant for
                          the whole row it added nothing but roughly 35px of
                          width per column — which is most of what was pushing
                          the table off the edge in the first place. */}
                      <span className="mt-1 block text-[11px] text-ink3">
                        {b.at} · <span className="vg-numeric">{n(b.coins!)}</span> سکه برای هر {UNIT_LABEL[b.kind]}
                      </span>
                    </td>
                    {cols.map((p) => {
                      const v = outputsPerMonth(p, b);
                      return (
                        <td key={p.id} className="border-t border-line px-2 py-4 text-center align-top">
                          {v == null || v === 0 ? (
                            // A plan whose month does not buy even one is an ×,
                            // not a zero. Zero reads as a number you could grow.
                            <X size={13} className="mx-auto text-ink3" />
                          ) : (
                            // 15px, up from 13. These are the numbers the page
                            // exists to show and they were the smallest thing on
                            // it, in a font that could not draw them.
                            <span className="vg-numeric text-[15px] font-semibold">{n(v)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {group.length > VISIBLE && (
                  <tr>
                    <td colSpan={cols.length + 1} className="border-t border-line p-3">
                      <button
                        onClick={() => setExpanded((s) => ({ ...s, [kind]: !open }))}
                        className="flex items-center gap-1.5 text-[12.5px] text-ink2"
                      >
                        <CaretDown size={12} weight="bold" className={open ? "rotate-180" : ""} />
                        {open ? "کمتر" : `${n(group.length - VISIBLE)} مدل دیگر`}
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
          const group = rows.filter((b) => b.kind === kind);
          const open = expanded[kind] ?? false;
          const shown = open ? group : group.slice(0, VISIBLE);
          return (
            <div key={kind}>
              <p className="mb-2 text-[15px] font-bold">{KIND_LABEL[kind]}</p>
              <div className="flex flex-col gap-2">
                {shown.map((b) => (
                  <div key={b.key} className="rounded-bezel border border-line p-3">
                    <p className="text-[13px]">
                      <bdi>{b.family}</bdi>
                      <span className="text-ink2"> · </span>
                      <bdi className="text-ink2">{b.variant}</bdi>
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink3">
                      {b.at} · <span className="vg-numeric">{n(b.coins!)}</span> سکه برای هر {UNIT_LABEL[kind]}
                    </p>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {cols.map((p) => {
                        const v = outputsPerMonth(p, b);
                        const lead = p.popular || p.id === currentPlanId;
                        return (
                          <div key={p.id} className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5">
                            <bdi className="truncate text-[11.5px]" style={{ color: lead ? "var(--color-accent)" : "var(--color-ink2)" }}>
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
              {group.length > VISIBLE && (
                <button
                  onClick={() => setExpanded((s) => ({ ...s, [kind]: !open }))}
                  className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink2"
                >
                  <CaretDown size={12} weight="bold" className={open ? "rotate-180" : ""} />
                  {open ? "کمتر" : `${n(group.length - VISIBLE)} مدل دیگر`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink3">
        اعداد سقف‌اند: سکه‌ها بین مدل‌ها مشترک‌اند، پس اگر از چند مدل استفاده کنی تعدادها بین‌شان تقسیم می‌شود.
        {cycle === "annual" && " سکه‌ی ماهانه‌ی پلن سالانه همان مقدار است؛ فقط قیمتش کمتر می‌شود."}
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
