import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowLeft, Check, CaretDown, EnvelopeSimple, Sparkle } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family } from "../data/models";
import { COMMUNITY } from "../data/community";
import { PLANS, monthlyCoins, toman, annualDiscountPct, effectiveUsd, type Plan } from "../data/plans";
import { minCoinsForFamily } from "../data/pricing";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import { useI18n, type TKey } from "../lib/i18n";
import { riseItem, riseParent } from "../lib/motion";
import { BRAND } from "../data/brand";

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
function TopNav({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const { t } = useI18n();
  return (
    /* A floating island, not a bar glued to the top edge.
       The glass reads as glass when there is something visible behind and
       around it; edge-to-edge it just looks like a lighter strip. The blur
       stays here rather than on any scrolling surface — a backdrop-filter over
       moving content repaints every frame and is the usual cause of a landing
       page that stutters on a phone. */
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
      <div
        className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between rounded-[1.75rem] pe-2 ps-6"
        style={{
          background: "var(--vg-glass)",
          backdropFilter: "blur(var(--vg-blur))",
          border: "1px solid var(--vg-border-subtle)",
        }}
      >
        {/* Wordmark over tagline, as the brand sheet sets it. Light weight and
            wide tracking, not the extrabold/tight it was — the logo is the one
            piece of type whose treatment is not ours to choose. */}
        <span className="flex flex-col leading-none">
          <span
            className="text-[20px] font-light tracking-[0.34em]"
            style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
          >
            {BRAND.name}
          </span>
          <span
            className="mt-1.5 hidden text-[9.5px] font-medium uppercase tracking-[0.2em] sm:block"
            style={{ color: "var(--vg-text-faint)", fontFamily: "var(--vg-font-latin)" }}
            lang="en"
          >
            {BRAND.tagline}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onSignIn}
            className="vg-ease rounded-full px-4 py-2.5 text-[13px] hover:text-[color:var(--vg-text)] active:scale-[0.98]"
            style={{ color: "var(--vg-text-secondary)" }}
          >
            {t("lp_login")}
          </button>
          <button
            onClick={onSignUp}
            className="vg-ease rounded-full px-5 py-2.5 text-[13px] font-semibold active:scale-[0.98]"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            {t("lp_signup")}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------- hero ---------- */
/* ---------------------------------------------------------------------------
   The hero, as a shot.

   The previous two attempts were both layouts: a centred column, then an
   asymmetric split. Recolouring one into the other is what "we just changed the
   colours and rounded the corners" was pointing at, and it was fair — a split
   with a thumbnail grid is an editorial SaaS pattern, and editorial is close to
   the opposite of cinematic.

   What makes a frame read as a shot is not the arrangement of boxes. It is that
   there is ONE light source, the light falls off into darkness at the edges, the
   subject stands in that light, and the type lives inside the frame rather than
   beside it. So this is not a section containing elements — it is a full
   viewport scene with layers at different depths:

     bloom      the key light, an ellipse behind the subject
     subject    DEEV, lit from within by its own veins
     type       over the scene, not next to it
     vignette   the falloff that turns a page into a frame
     grain      film, so black is not flat

   The layers move at different rates on scroll. That is the whole parallax: the
   light drifts slowest because it is furthest away, the subject next, the type
   fastest because it is closest to the viewer. Two transforms and no library
   beyond the one already here.

   `min-h-[100dvh]`, never `h-screen` — on iOS Safari the toolbar collapse
   changes `vh` mid-scroll and the whole shot jumps.
   --------------------------------------------------------------------------- */
function Hero({ onSignIn }: { onSignIn: () => void }) {
  const { t, n } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const [mascotFailed, onMascotError] = useImageFallback();

  /* Progress through the hero itself, not the page: `offset` ties 0 to the
     frame's top meeting the viewport top and 1 to its bottom leaving it, so the
     parallax is the same at every viewport height instead of drifting on tall
     screens. */
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start start", "end start"] });
  const lightY = useTransform(scrollYProgress, [0, 1], ["0%", "14%"]);
  const subjectY = useTransform(scrollYProgress, [0, 1], ["0%", "26%"]);
  const typeY = useTransform(scrollYProgress, [0, 1], ["0%", "44%"]);
  const typeFade = useTransform(scrollYProgress, [0, 0.72], [1, 0]);

  return (
    <div ref={frame} className="vg-grain relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden">
      {/* Key light. Furthest back, so it moves least. */}
      <motion.div style={{ y: lightY }} className="vg-bloom pointer-events-none absolute inset-0" aria-hidden />

      {/* The subject.
          Drawn whether or not the artwork has landed: the glow is the mascot's
          own veins bleeding into the air, and on its own it already reads as
          something standing in the dark. When brand/deev-mascot.png exists it
          drops into this frame with nothing else to change — which is why the
          slot is built now rather than waiting for the file. */}
      <motion.div
        style={{ y: subjectY }}
        className="pointer-events-none absolute inset-x-0 bottom-0 top-[12%] flex items-end justify-center"
        aria-hidden
      >
        <div className="relative h-full w-full max-w-[560px]">
          <div className="vg-subject-glow absolute inset-x-0 bottom-[8%] top-[18%]" />
          {!mascotFailed && (
            <img
              src="/brand/deev-mascot.png"
              alt=""
              onError={onMascotError}
              className="absolute inset-x-0 bottom-0 mx-auto h-[86%] w-auto object-contain"
              style={{ filter: "drop-shadow(0 0 60px rgb(var(--vg-primary-rgb) / 0.25))" }}
            />
          )}
        </div>
      </motion.div>

      {/* Falloff, over the subject and under the type — this is the layer that
          turns a lit page into a framed one. */}
      <div className="vg-vignette pointer-events-none absolute inset-0" aria-hidden />

      {/* Type, inside the frame. Closest to the viewer, so it moves most and is
          the first thing to leave as the shot is scrolled past. */}
      <motion.div
        style={{ y: typeY, opacity: typeFade }}
        className="relative z-[2] mx-auto w-full max-w-[900px] px-5 pb-16 pt-28 text-center sm:px-8"
      >
        <motion.div variants={riseParent} initial="hidden" animate="show">
          <motion.span
            variants={riseItem}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.32em]"
            style={{ color: "var(--vg-text-faint)", fontFamily: "var(--vg-font-latin)" }}
            lang="en"
          >
            <Sparkle size={11} weight="fill" />
            Artificial Intelligence
          </motion.span>

          {/* Bigger than the split version and centred on purpose: in a frame
              the subject sits on the centre line, and type that ducks to one
              side to avoid it is type that has lost the argument with the
              image. */}
          <motion.h1
            variants={riseItem}
            className="mx-auto mt-6 max-w-[15ch] text-[clamp(2.75rem,7.5vw,5.75rem)] font-extrabold leading-[1.08]"
            style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
          >
            {t("lp_hero_title")}
          </motion.h1>

          <motion.p
            variants={riseItem}
            className="mx-auto mt-6 max-w-[46ch] text-[15px] leading-[2] md:text-[16.5px]"
            style={{ color: "var(--vg-text-secondary)" }}
          >
            {t("lp_hero_sub")}
          </motion.p>

          <motion.div variants={riseItem} className="mt-10 flex flex-col items-center gap-3">
            <button
              onClick={onSignIn}
              className="vg-ease group flex items-center gap-3 rounded-full ps-8 pe-2 text-[15px] font-bold active:scale-[0.98]"
              style={{
                height: "var(--vg-cta-height)",
                background: "var(--vg-primary)",
                color: "var(--vg-text-on-primary)",
                /* The one glow in the product, and it belongs here: in a lit
                   frame the brightest object should look like it emits. */
                boxShadow: "0 0 48px rgb(var(--vg-primary-rgb) / 0.35)",
              }}
            >
              {t("lp_cta_start")}
              <span
                className="vg-ease grid size-9 place-items-center rounded-full group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5"
                style={{ background: "rgb(0 0 0 / 0.14)" }}
              >
                <ArrowLeft size={15} weight="bold" className="ltr:-scale-x-100" />
              </span>
            </button>
            <span className="text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              {t("lp_gift_note").replace("{n}", n(12))}
            </span>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* The seam out of the shot. The mascot's crack, used once, where the
          frame ends and the page begins. */}
      <hr className="vg-vein absolute inset-x-0 bottom-0 z-[2] w-full" aria-hidden />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The reel.

   The proof that any of this works is the work itself, and the hero has no room
   for it any more — a shot with a thumbnail grid in it is not a shot. So it
   comes straight after, and it is edge to edge.

   Full-bleed on purpose. A contained grid says "here are some samples"; frames
   running off both sides say the reel continues past the screen, which is both
   truer and the reason a film strip reads the way it does. Faded at the edges
   with the same mask the nav uses, so the cut is light rather than a hard crop.
   --------------------------------------------------------------------------- */
function Reel() {
  const reel = [...COMMUNITY].sort((a, b) => b.likes - a.likes).slice(0, 8);
  return (
    <section className="vg-fade-start vg-fade-end -mt-px overflow-hidden py-10 md:py-14" aria-hidden>
      {/* One row, no wrap, wider than the viewport. `w-max` rather than a grid:
          the strip is meant to overflow, and a grid would helpfully prevent it. */}
      <div className="flex w-max gap-3 px-5 sm:px-8">
        {reel.map((p, i) => (
          <div
            key={p.id}
            className="vg-bezel shrink-0"
            /* Alternating heights, so the strip has a horizon rather than a
               ruler edge. */
            style={{ marginTop: i % 2 === 0 ? 0 : 28 }}
          >
            <div className="relative h-[220px] w-[164px] md:h-[280px] md:w-[210px]">
              <Art family={getFamily(p.familyId)} />
            </div>
          </div>
        ))}
      </div>
    </section>
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
                annual === v ? { background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" } : { color: "var(--vg-text-muted)" }
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
      <div className="mt-8 flex justify-center">
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
          <EnvelopeSimple size={17} weight="bold" />
          {t("lp_email")}
        </button>
      </div>
      <p className="mt-5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        {t("lp_no_password")}
      </p>
    </Section>
  );
}

/* ============================================================ */
export default function Landing({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const { t } = useI18n();
  return (
    <div className="relative z-10 min-h-[100dvh]">
      <TopNav onSignIn={onSignIn} onSignUp={onSignUp} />
      <Hero onSignIn={onSignUp} />
      <Reel />
      <Models />
      <Features />
      <Plans onSignIn={onSignUp} />
      <Faq />
      <Closing onSignIn={onSignUp} />
      <footer
        className="border-t px-5 py-8 text-center text-[12px] sm:px-8"
        style={{ borderColor: "var(--vg-border-subtle)", color: "var(--vg-text-faint)" }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Check size={13} weight="bold" />
          {t("lp_footer")}
        </span>
      </footer>
    </div>
  );
}
