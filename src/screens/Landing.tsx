import { useState } from "react";
import { motion } from "framer-motion";
import { CaretDown, Check } from "@phosphor-icons/react";
import { effectiveUsd } from "../data/plans";
import type { Plan } from "../runtime/contracts/plans";
import { EntryCard, PlanCard, type Cycle } from "../components/PlanCards";
import { HeroSection } from "../components/blocks/hero-section-5";
import { FeaturesBento } from "../components/blocks/bento-features";
import { useI18n, type TKey } from "../lib/i18n";
import { riseParent } from "../lib/motion";
import { Wordmark } from "../components/brandMarks";
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
   `GET /plans` ladder the buy screen prices from — a landing page that lies
   about the price is worse than no landing page. */

/**
 * The names that make someone stop — not the first six in catalogue order.
 *
 * The row used to be `FAMILIES.slice(0, 6)`, which is whatever happens to sit at
 * the top of the catalogue. That is the wrong selection for a hero: this row's
 * job is recognition, so it has to be the models a visitor has already heard of
 * and would be surprised to find here. Chosen by name rather than by position.
 *
 * The landing test resolves these names against the live catalogue so a rename
 * or retirement cannot silently shrink the model band.
 */
export const HERO_MODEL_IDS = ["veo", "kling", "seedance", "wan", "minimax-h3", "nano-banana", "gpt-image", "gemini-omni", "elevenlabs"];

const FAQ_KEYS: { q: TKey; a: TKey }[] = [
  { q: "lp_faq1_q", a: "lp_faq1_a" },
  { q: "lp_faq2_q", a: "lp_faq2_a" },
  { q: "lp_faq3_q", a: "lp_faq3_a" },
  { q: "lp_faq4_q", a: "lp_faq4_a" },
];

/** A wide, continuous section shell. The landing relies on content and scale
    for hierarchy instead of drawing a divider around every chapter. */
function Section({
  children,
  className,
  light,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  light?: "start" | "end";
  /** Only where something links to the section — an anchor needs a target. */
  id?: string;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      {...(light ? { "data-light": light } : {})}
      className={`relative mx-auto w-full max-w-[1600px] px-5 py-12 sm:px-8 md:py-16 lg:px-10 ${className ?? ""}`}
    >
      {children}
    </section>
  );
}

/**
 * Sections rise as they arrive, once.
 *
 * `whileInView` with `once`, not a scroll scrub: a scrubbed reveal ties content
 * to scroll position and reverses when the user scrolls back, which reads as the
 * page being unsure. Arriving once is the thing that makes a chapter feel like
 * it starts. framer-motion honours prefers-reduced-motion through the
 * MotionConfig in app/providers.tsx, so this needs no guard of its own.
 */
function Rise({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={riseParent} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} className={className}>
      {children}
    </motion.div>
  );
}

/** Section hierarchy comes from type, not numbered rules between blocks. */
function Heading({ index, children, sub }: { index: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-7 md:mb-9" data-section={index}>
      <h2
        className="max-w-[22ch] text-balance text-[30px] font-extrabold leading-[1.2] md:text-[42px]"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
      >
        {children}
      </h2>
      {sub && (
        <p className="mt-2.5 max-w-[58ch] text-pretty text-[13.5px] leading-[1.85]" style={{ color: "var(--vg-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   02 — the product beyond generation.

   The model band inside the hero answers "what can I use?". This answers the
   next question: "what does DEEV help me do with it?"
   --------------------------------------------------------------------------- */
function Features() {
  const { t } = useI18n();
  return (
    <Section id="features" light="end" className="scroll-mt-24">
      <div className="sr-only">
        <h2>{t("lp_features_title")}</h2>
        <p>{t("lp_features_sub")}</p>
      </div>
      <Rise>
        <FeaturesBento />
      </Rise>
    </Section>
  );
}

/* ---------- plans ----------
   The cards are the plans screen's own — same component, same flip, same
   numbers. The landing keeps only what is its own: the entry/main tabs, the
   monthly/yearly switch, and the wash behind them. */

function Plans({ plans, onSignIn }: { plans: readonly Plan[]; onSignIn: () => void }) {
  const { t } = useI18n();
  const [annual, setAnnual] = useState(false);
  const [group, setGroup] = useState<Plan["group"]>("entry");
  const cycle: Cycle = annual ? "annual" : "monthly";
  const activePlans = plans.filter((plan) => plan.group === group).sort((a, b) => effectiveUsd(a, false) - effectiveUsd(b, false));
  const groupTone = group === "entry" ? { rgb: "92 175 255", hex: "#5cafff" } : { rgb: "255 57 126", hex: "#ff397e" };

  return (
    <Section light="start" id="plans" className="isolate">
      <motion.div
        key={`plan-wash-${group}`}
        aria-hidden
        className="pointer-events-none absolute inset-x-[3%] top-[18%] -z-10 h-[72%] rounded-[50%] blur-3xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45 }}
        style={{
          background: `radial-gradient(ellipse at 74% 20%, rgb(${groupTone.rgb} / 0.12), transparent 42%), radial-gradient(ellipse at 18% 74%, rgb(255 148 72 / 0.07), transparent 38%)`,
        }}
      />
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <Heading index="07">{t("lp_plans_title")}</Heading>
          <p className="mt-2 max-w-[620px] text-[14px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
            {t("lp_plans_sub")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:mb-12 md:justify-end">
          <div
            className="inline-flex shrink-0 rounded-pill p-1"
            style={{ background: "var(--vg-surface-raised)" }}
            role="group"
            aria-label={t("lp_plans_group_label")}
          >
            {(["entry", "main"] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setGroup(value);
                  if (value === "entry") setAnnual(false);
                }}
                aria-pressed={group === value}
                className="vg-ease rounded-pill px-4 py-2 text-[12.5px] font-semibold"
                style={
                  group === value
                    ? {
                        background: `rgb(${value === "entry" ? "92 175 255" : "255 57 126"} / 0.16)`,
                        color: value === "entry" ? "#9fd1ff" : "#ff8bb3",
                        boxShadow: `inset 0 0 0 1px rgb(${value === "entry" ? "92 175 255" : "255 57 126"} / 0.32), 0 0 22px -12px rgb(${value === "entry" ? "92 175 255" : "255 57 126"} / 0.8)`,
                      }
                    : { color: "var(--vg-text-faint)" }
                }
              >
                {t(value === "entry" ? "lp_plans_personal" : "lp_plans_professional")}
              </button>
            ))}
          </div>

          {group === "main" && (
            <div
              className="inline-flex shrink-0 rounded-pill p-1"
              style={{ background: "var(--vg-surface-raised)" }}
              role="group"
              aria-label={t("lp_plans_cycle_label")}
            >
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  onClick={() => setAnnual(value)}
                  aria-pressed={annual === value}
                  className="vg-ease rounded-pill px-4 py-2 text-[12.5px] font-semibold"
                  style={
                    annual === value
                      ? {
                          background: `rgb(${groupTone.rgb} / 0.16)`,
                          color: groupTone.hex,
                          boxShadow: `inset 0 0 0 1px rgb(${groupTone.rgb} / 0.28)`,
                        }
                      : { color: "var(--vg-text-faint)" }
                  }
                >
                  {value ? t("lp_annual") : t("lp_monthly")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-[13px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
          {t(group === "entry" ? "lp_plans_entry" : "lp_plans_main")}
        </p>
        <p className="hidden text-[11px] sm:block" style={{ color: "var(--vg-text-faint)" }}>
          {t("lp_plans_estimate_note")}
        </p>
      </div>
      <motion.div
        key={group}
        data-testid="landing-plan-grid"
        dir="rtl"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className={`grid gap-3 ${group === "entry" ? "sm:grid-cols-2 xl:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        {activePlans.map((plan) =>
          /* The plans screen's own cards — see `components/PlanCards`. The
             landing drew a flat copy of them, which drifted into a second
             design for the same plan; a visitor comparing the front page with
             /plans was reading two answers. No account is passed: nobody is
             signed in here, so the price is the list price. */
          group === "entry" ? (
            <EntryCard key={plan.code} plan={plan} cycle={cycle} current={false} onSelect={onSignIn} />
          ) : (
            <PlanCard key={plan.code} plan={plan} cycle={cycle} current={false} onSelect={onSignIn} />
          ),
        )}
      </motion.div>

      <div
        className="mt-5 flex flex-col items-center justify-center gap-1 text-center text-[12px] sm:flex-row sm:gap-2"
        style={{ color: "var(--vg-text-faint)" }}
      >
        <span>{t("pl_expiry_note")}</span>
        <span className="hidden sm:inline" aria-hidden="true">
          ·
        </span>
        <span className="sm:hidden">{t("lp_plans_estimate_note")}</span>
      </div>
    </Section>
  );
}

/* ---------- faq ---------- */
function Faq() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section light="end" id="faq">
      <Heading index="09">{t("lp_faq_title")}</Heading>
      <div className="mx-auto flex max-w-[720px] flex-col gap-2">
        {FAQ_KEYS.map(({ q, a }, i) => {
          const on = open === i;
          return (
            <div
              key={q}
              className="vg-ease overflow-hidden rounded-2xl"
              style={{
                background: "var(--vg-surface)",
                border: `1px solid ${on ? "var(--vg-primary-a20)" : "var(--vg-border-subtle)"}`,
              }}
            >
              <button
                onClick={() => setOpen(on ? null : i)}
                aria-expanded={on}
                className="flex w-full items-center justify-between gap-4 p-4 text-start"
              >
                <span className="text-[14px] font-medium" style={{ color: on ? "var(--vg-text)" : "var(--vg-text-secondary)" }}>
                  {t(q)}
                </span>
                <CaretDown
                  size={16}
                  weight="bold"
                  className={`vg-ease shrink-0 ${on ? "rotate-180" : ""}`}
                  style={{ color: on ? "var(--vg-primary)" : "var(--vg-text-muted)" }}
                />
              </button>
              {/* The answer grows instead of appearing. A `0fr → 1fr` grid row
                  is the one way to animate to content height without measuring
                  it in JS, and it stays out of the way of `height: auto`, which
                  cannot be transitioned at all. The child keeps
                  `min-height: 0` — without it a grid item refuses to shrink
                  below its content and the row never closes. */}
              <div className="vg-ease grid" style={{ gridTemplateRows: on ? "1fr" : "0fr" }}>
                <div className="min-h-0 overflow-hidden">
                  <p className="px-4 pb-4 text-[13px] leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
                    {t(a)}
                  </p>
                </div>
              </div>
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
    /* The end card. Deliberately the one section that comes back to the hero's
       language — key light, vignette, centred type — because a film's last frame
       rhymes with its first. Everything between the two is a page; these two are
       the frame around it. */
    <div className="relative isolate overflow-hidden">
      <div className="vg-bloom pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="vg-vignette pointer-events-none absolute inset-0" aria-hidden />
      <Section className="relative z-[1] text-center">
        {/* Raised with the section headings, which just went to 52px and were
            about to match it. The ladder has to stay hero > closing > section:
            the last frame rhymes with the first, and a finale the same size as
            the chapter before it is not a finale. */}
        <h2
          className="mx-auto max-w-[18ch] text-[clamp(2.25rem,6vw,4rem)] font-extrabold leading-[1.15]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          {t("lp_closing_title")}
        </h2>
        <div className="mt-8 flex justify-center">
          <button
            onClick={onSignIn}
            className="vg-ease flex items-center gap-2 rounded-pill px-7 text-[14px] font-semibold active:scale-[0.98]"
            style={{
              height: "var(--vg-cta-height)",
              background: "var(--vg-primary)",
              color: "var(--vg-text-on-primary)",
              boxShadow: "0 0 48px rgb(var(--vg-primary-rgb) / 0.35)",
            }}
          >
            {/* Names no method: phone sign-in exists only where an SMS gateway
                does, and this page cannot promise a door the server may not have. */}
            {t("lp_phone")}
          </button>
        </div>
        <p className="mt-5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
          {t("lp_no_password")}
        </p>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   12 — the footer.

   It was one line of text. A footer is where someone goes looking for the things
   a landing page is not allowed to shout about — the terms, what happens to
   their coins, how to reach a human — and having none of them says either that
   they do not exist or that we would rather not say.

   Every link here points at a route that does not exist yet. They are `href`s
   rather than buttons because that is what they will be, and a dead `#` would
   have to be found and changed later; these are marked once, here, in one list.
   --------------------------------------------------------------------------- */
const FOOTER_LINKS: { group: TKey; items: { label: TKey; href: string }[] }[] = [
  {
    group: "lp_footer_product",
    items: [
      { label: "lp_nav_models", href: "#models" },
      { label: "lp_nav_plans", href: "#plans" },
      { label: "lp_nav_faq", href: "#faq" },
    ],
  },
  {
    group: "lp_footer_legal",
    items: [
      { label: "lp_footer_terms", href: "/terms" },
      { label: "lp_footer_privacy", href: "/privacy" },
      { label: "lp_footer_refund", href: "/coins" },
      { label: "lp_footer_cookies", href: "/cookies" },
    ],
  },
  /* The company column. These three links were the reason this list needed
     revisiting at all: the legal column above pointed at /terms, /privacy and
     /coins, and none of those pages existed — so the footer of the landing
     page served three 404s to anybody who clicked it, which is exactly what a
     reviewer does first. */
  {
    group: "lp_footer_company",
    items: [
      { label: "lp_footer_company", href: "/about" },
      { label: "lp_footer_contact", href: "/contact" },
    ],
  },
];

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="px-5 pb-10 pt-14 sm:px-8">
      <div className="mx-auto grid w-full max-w-[1600px] gap-10 lg:px-2 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="grid gap-3">
          <span style={{ color: "var(--vg-text)" }}>
            <Wordmark height={20} title={BRAND.name} />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
            <Check size={13} weight="bold" />
            {t("lp_footer")}
          </span>
        </div>

        {FOOTER_LINKS.map((column) => (
          <nav key={column.group} className="grid content-start gap-3" aria-label={t(column.group)}>
            <span className="text-[12px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
              {t(column.group)}
            </span>
            <ul className="grid gap-2.5">
              {column.items.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="vg-ease text-[12.5px] hover:text-[color:var(--vg-text)]"
                    style={{ color: "var(--vg-text-faint)" }}
                  >
                    {t(item.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-[1600px] pt-2 text-[11.5px] lg:px-2" style={{ color: "var(--vg-text-faint)" }}>
        <span>
          <span lang="en">DEEV</span> — {t("lp_footer_rights")}
        </span>
      </div>
    </footer>
  );
}

/* ============================================================ */
/**
 * `plans` is a prop rather than a context read because this is the one screen
 * that renders with nobody signed in, above the whole authenticated tree — the
 * providers the app shell mounts are not there yet.
 */
export default function Landing({
  plans,
  onSignIn,
  onSignUp,
  signedIn,
}: {
  plans: readonly Plan[];
  onSignIn: () => void;
  onSignUp: () => void;
  /** Reachable from the wordmark while signed in, where the auth CTAs do not apply. */
  signedIn?: boolean | undefined;
}) {
  return (
    /* `overflow-x: clip`, not `hidden`. The section lights are meant to spill
       past their section — that overhang is what stops them looking like boxes
       — so something has to stop the spill widening the document. `hidden`
       would do it and would also silently kill the sticky nav, because an
       ancestor with `overflow: hidden` makes `position: sticky` scroll away.
       `clip` trims the paint without creating a scroll container. */
    <div
      className="relative z-10 min-h-[100dvh] [overflow-x:clip]"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 42% 13% at 3% 24%, rgb(82 79 255 / 0.075), transparent 72%), radial-gradient(ellipse 46% 15% at 98% 49%, rgb(255 54 126 / 0.065), transparent 72%), radial-gradient(ellipse 40% 12% at 8% 73%, rgb(255 139 61 / 0.055), transparent 72%)",
      }}
    >
      {/* Keep the first public pass visual and product-led: hero, tool mosaic,
          plans and common questions. Editorial sections inspired
          by creator platforms can be inserted later without carrying over the
          temporary calculator, comparison, steps or trust blocks. */}
      {/* Nav, hero and the model band come from the Tailark block as given —
          `src/components/blocks/hero-section-5.tsx`. It carries its own header,
          so there is no TopNav here, and its slider is the model wall, so there
          is no separate Models section either. What could not come across
          verbatim is listed at the top of that file. */}
      <HeroSection plans={plans} onSignIn={onSignIn} onSignUp={onSignUp} signedIn={signedIn} />
      <Features />
      <Plans plans={plans} onSignIn={onSignUp} />
      <Faq />
      <Closing onSignIn={onSignUp} />
      <Footer />
    </div>
  );
}
