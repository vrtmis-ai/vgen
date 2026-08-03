import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, CaretDown, GoogleLogo, DeviceMobile, Sparkle } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family } from "../data/models";
import { COMMUNITY } from "../data/community";
import { PLANS, monthlyCoins, toman, annualDiscountPct, effectiveUsd, type Plan } from "../data/plans";
import { minCoinsForFamily } from "../data/pricing";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import { useI18n, type TKey } from "../lib/i18n";
import { riseItem, riseParent } from "../lib/motion";

/* Built from stitch-export/desktop/vgen-persian-home-unified.html.
   Measured, not eyeballed: hero 48/700, section headings 30, section padding
   96px block / 32px inline, model row on a 6-column grid, plans on 2.

   This is the logged-out surface §14 asks for and the app has never had — until
   now an anonymous visitor got one line of text. It is also the one screen that
   is desktop-first by nature, so it is where the web version starts. It touches
   no existing screen, which is why it goes first: zero regression surface.

   Everything on it is real. The model row is the actual catalogue, the prices
   are computed from the live rate table, and the plan cards read the same
   PLANS rows the buy screen does — a landing page that lies about the price is
   worse than no landing page. */

const FAQ_KEYS: { q: TKey; a: TKey }[] = [
  { q: "lp_faq1_q", a: "lp_faq1_a" },
  { q: "lp_faq2_q", a: "lp_faq2_a" },
  { q: "lp_faq3_q", a: "lp_faq3_a" },
  { q: "lp_faq4_q", a: "lp_faq4_a" },
];

function Art({ family }: { family?: Family | undefined }) {
  const [failed, onError] = useImageFallback();
  const cover = family?.cover;
  return (
    <>
      <span className="absolute inset-0 block" style={{ background: family?.grad ?? "var(--vg-surface-overlay)" }} />
      {cover && isVideoUrl(cover) ? (
        <video src={cover} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : cover && !failed ? (
        <img src={cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={onError} />
      ) : null}
    </>
  );
}

/** Section shell. 96/32 on desktop, tighter on a phone — the export's rhythm
    would waste a third of a small screen on empty space. */
function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={`mx-auto w-full max-w-[1200px] px-5 py-14 sm:px-8 md:py-24 ${className ?? ""}`}>{children}</section>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-center text-[24px] font-bold leading-tight md:text-[30px]" style={{ color: "var(--vg-text)" }}>
      {children}
    </h2>
  );
}

/* ---------- nav ---------- */
function TopNav({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <header
      className="sticky top-0 z-30 border-b"
      style={{ background: "var(--vg-glass)", backdropFilter: "blur(var(--vg-blur))", borderColor: "var(--vg-border-subtle)" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <span className="text-[20px] font-extrabold tracking-tight" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
          VGen
        </span>
        <div className="flex items-center gap-2">
          <button onClick={onSignIn} className="rounded-md px-3.5 py-2 text-[13px] active:scale-95" style={{ color: "var(--vg-text-secondary)" }}>
            {t("lp_login")}
          </button>
          <button
            onClick={onSignIn}
            className="rounded-md px-4 py-2 text-[13px] font-semibold active:scale-95"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)", boxShadow: "var(--vg-glow-primary)" }}
          >
            {t("lp_signup")}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------- hero ---------- */
function Hero({ onSignIn }: { onSignIn: () => void }) {
  const { t, n } = useI18n();
  const showcase = [...COMMUNITY].sort((a, b) => b.likes - a.likes).slice(0, 6);
  return (
    <div className="relative overflow-hidden">
      {/* the light leak the system defines for hero surfaces */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "var(--vg-light-leak)" }} aria-hidden />
      <Section className="!pb-8 text-center md:!pb-10">
        <motion.div variants={riseParent} initial="hidden" animate="show">
          <motion.span
            variants={riseItem}
            className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ background: "var(--vg-primary-a10)", color: "var(--vg-primary-soft)", fontFamily: "var(--vg-font-latin)" }}
            lang="en"
          >
            <Sparkle size={12} weight="fill" />
            Artificial Intelligence
          </motion.span>

          <motion.h1
            variants={riseItem}
            className="mx-auto mt-6 max-w-[16ch] text-[34px] font-bold leading-[1.25] md:text-[48px]"
            style={{ color: "var(--vg-text)" }}
          >
            {t("lp_hero_title")}
          </motion.h1>

          <motion.p
            variants={riseItem}
            className="mx-auto mt-4 max-w-[46ch] text-[14px] leading-[1.9] md:text-[16px]"
            style={{ color: "var(--vg-text-muted)" }}
          >
            {t("lp_hero_sub")}
          </motion.p>

          <motion.div variants={riseItem} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onSignIn}
              className="flex items-center gap-2 rounded-md px-6 text-[14px] font-semibold active:scale-[0.98]"
              style={{
                height: "var(--vg-cta-height)",
                background: "var(--vg-primary)",
                color: "var(--vg-text-on-primary)",
                boxShadow: "var(--vg-glow-primary-lg)",
              }}
            >
              {t("lp_cta_start")}
              <ArrowLeft size={16} weight="bold" className="ltr:-scale-x-100" />
            </button>
            <span className="text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              {t("lp_gift_note").replace("{n}", n(12))}
            </span>
          </motion.div>
        </motion.div>
      </Section>

      {/* a strip of real work, bleeding off both edges */}
      <div className="relative mx-auto max-w-[1400px] px-5 pb-16 sm:px-8 md:pb-24">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6 md:gap-3">
          {showcase.map((p, i) => (
            <div
              key={p.id}
              className="relative aspect-[3/4] overflow-hidden rounded-md"
              style={{ opacity: i > 2 ? 0.55 : 1 }}
            >
              <Art family={getFamily(p.familyId)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- one platform, every model ---------- */
function Models() {
  const { t, n } = useI18n();
  const shown = FAMILIES.slice(0, 12);
  return (
    <Section>
      <Heading>{t("lp_models_title")}</Heading>
      <p className="mx-auto mt-3 max-w-[52ch] text-center text-[13.5px] leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
        {t("lp_models_sub")}
      </p>
      <div className="mt-9 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        {shown.map((f) => {
          const p = minCoinsForFamily(f);
          return (
            <div
              key={f.id}
              className="flex flex-col items-center gap-2 rounded-md p-3.5 text-center"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
            >
              <VendorMark vendor={f.vendor} size={26} />
              <span className="truncate text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }} lang="en">
                {f.name}
              </span>
              <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                {p == null ? t("home_price_na") : `${t("home_price_from")} ${n(p)}`}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------- for tomorrow's creators ---------- */
function Features() {
  const { t } = useI18n();
  const items: { k: TKey; d: TKey }[] = [
    { k: "lp_f1", d: "lp_f1_d" },
    { k: "lp_f2", d: "lp_f2_d" },
    { k: "lp_f3", d: "lp_f3_d" },
  ];
  return (
    <Section>
      <Heading>{t("lp_features_title")}</Heading>
      <div className="mt-9 grid gap-3 md:grid-cols-3">
        {items.map(({ k, d }) => (
          <div
            key={k}
            className="rounded-md p-6"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", backgroundImage: "var(--vg-cool-leak)" }}
          >
            <h3 className="text-[17px] font-bold" style={{ color: "var(--vg-text)" }}>
              {t(k)}
            </h3>
            <p className="mt-2 text-[13.5px] leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
              {t(d)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- plans ----------
   Real rows from plans.ts. The landing shows the two "main" plans; the full
   ladder lives on the buy screen, and duplicating it here would be a second
   place to forget to update. */
function Plans({ onSignIn }: { onSignIn: () => void }) {
  const { t, n } = useI18n();
  const [annual, setAnnual] = useState(false);
  const main = PLANS.filter((p) => p.group === "main").slice(0, 2);
  return (
    <Section>
      <Heading>{t("lp_plans_title")}</Heading>

      <div className="mt-6 flex justify-center">
        <div className="inline-flex rounded-pill p-1" style={{ background: "var(--vg-surface-raised)" }}>
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => setAnnual(v)}
              className="rounded-pill px-4 py-2 text-[12.5px] font-medium transition-colors"
              style={
                annual === v
                  ? { background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }
                  : { color: "var(--vg-text-muted)" }
              }
            >
              {v ? t("lp_annual") : t("lp_monthly")}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-[840px] gap-3 md:grid-cols-2">
        {main.map((plan) => (
          <PlanCard key={plan.id} plan={plan} annual={annual} onSignIn={onSignIn} />
        ))}
      </div>

      <p className="mt-5 text-center text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        {t("lp_plans_note").replace("{n}", n(30))}
      </p>
    </Section>
  );
}

function PlanCard({ plan, annual, onSignIn }: { plan: Plan; annual: boolean; onSignIn: () => void }) {
  const { t, n } = useI18n();
  const usd = effectiveUsd(plan, annual);
  const off = annualDiscountPct(plan);
  const unavailable = annual && plan.annualUsdPerMonth == null;
  return (
    <div
      className="relative flex flex-col rounded-md p-6"
      style={{
        background: "var(--vg-surface)",
        border: `1px solid ${plan.popular ? "var(--vg-primary)" : "var(--vg-border-subtle)"}`,
      }}
    >
      {plan.popular && (
        <span
          className="absolute -top-2.5 start-6 rounded-pill px-2.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          {t("w_tag_popular")}
        </span>
      )}
      <span className="text-[18px] font-bold" style={{ color: "var(--vg-text)" }} lang="en">
        {plan.name}
      </span>
      <span className="mt-1 text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
        {n(monthlyCoins(plan))} {t("lp_coins_month")}
      </span>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-[26px] font-bold tabular-nums" style={{ color: "var(--vg-text)" }}>
          {n(toman(usd))}
        </span>
        <span className="text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
          {t("lp_toman_month")}
        </span>
      </div>
      {annual && off > 0 && (
        <span className="mt-1 text-[12px] font-medium" style={{ color: "var(--vg-primary-soft)" }}>
          {n(off)}٪ {t("lp_off")}
        </span>
      )}
      {unavailable && (
        <span className="mt-1 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
          {t("lp_monthly_only")}
        </span>
      )}

      <button
        onClick={onSignIn}
        className="mt-6 rounded-md py-3 text-[13.5px] font-semibold active:scale-[0.98]"
        style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
      >
        {t("lp_cta_start")}
      </button>
    </div>
  );
}

/* ---------- faq ---------- */
function Faq() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section>
      <Heading>{t("lp_faq_title")}</Heading>
      <div className="mx-auto mt-8 flex max-w-[720px] flex-col gap-2">
        {FAQ_KEYS.map(({ q, a }, i) => {
          const on = open === i;
          return (
            <div key={q} className="rounded-md" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
              <button
                onClick={() => setOpen(on ? null : i)}
                aria-expanded={on}
                className="flex w-full items-center justify-between gap-4 p-4 text-start"
              >
                <span className="text-[14px] font-medium" style={{ color: "var(--vg-text)" }}>
                  {t(q)}
                </span>
                <CaretDown
                  size={16}
                  weight="bold"
                  className={`shrink-0 transition-transform ${on ? "rotate-180" : ""}`}
                  style={{ color: "var(--vg-text-muted)" }}
                />
              </button>
              {on && (
                <p className="px-4 pb-4 text-[13px] leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
                  {t(a)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ---------- closing cta ---------- */
function Closing({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <Section className="text-center">
      <h2 className="mx-auto max-w-[18ch] text-[28px] font-bold leading-[1.3] md:text-[48px]" style={{ color: "var(--vg-text)" }}>
        {t("lp_closing_title")}
      </h2>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={onSignIn}
          className="flex items-center gap-2 rounded-md px-6 text-[14px] font-semibold active:scale-[0.98]"
          style={{ height: "var(--vg-cta-height)", background: "var(--vg-primary)", color: "var(--vg-text-on-primary)", boxShadow: "var(--vg-glow-primary-lg)" }}
        >
          <GoogleLogo size={17} weight="bold" />
          {t("lp_google")}
        </button>
        <button
          onClick={onSignIn}
          className="flex items-center gap-2 rounded-md px-6 text-[14px] font-semibold active:scale-[0.98]"
          style={{ height: "var(--vg-cta-height)", background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
        >
          <DeviceMobile size={17} />
          {t("lp_phone")}
        </button>
      </div>
      <p className="mt-5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        {t("lp_no_password")}
      </p>
    </Section>
  );
}

/* ============================================================ */
export default function Landing({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <div className="relative z-10 min-h-[100dvh]">
      <TopNav onSignIn={onSignIn} />
      <Hero onSignIn={onSignIn} />
      <Models />
      <Features />
      <Plans onSignIn={onSignIn} />
      <Faq />
      <Closing onSignIn={onSignIn} />
      <footer className="border-t px-5 py-8 text-center text-[12px] sm:px-8" style={{ borderColor: "var(--vg-border-subtle)", color: "var(--vg-text-faint)" }}>
        <span className="inline-flex items-center gap-1.5">
          <Check size={13} weight="bold" />
          {t("lp_footer")}
        </span>
      </footer>
    </div>
  );
}
