import { useId, useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { ArrowLeft, Check, CaretDown, DeviceMobile, List, Sparkle, X } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family } from "../data/models";
import { COMMUNITY } from "../data/community";
import { toman, annualDiscountPct, effectiveUsd } from "../data/plans";
import type { Plan } from "../runtime/contracts/plans";
import { minCoinsForFamily } from "../data/pricing";
import { Marquee } from "../components/Marquee";
import { ModelMark } from "../components/ModelMark";
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

/**
 * The names that make someone stop — not the first six in catalogue order.
 *
 * The row used to be `FAMILIES.slice(0, 6)`, which is whatever happens to sit at
 * the top of the catalogue. That is the wrong selection for a hero: this row's
 * job is recognition, so it has to be the models a visitor has already heard of
 * and would be surprised to find here. Chosen by name rather than by position.
 *
 * Resolved against the real catalogue and filtered, so a model that is ever
 * retired drops out of the row instead of advertising something we stopped
 * selling. Order is this list's, not the catalogue's — video first, because that
 * is the expensive thing people come for.
 */
export const HERO_MODEL_IDS = ["veo", "kling", "seedance", "wan", "minimax-h3", "nano-banana", "gpt-image", "gemini-omni", "elevenlabs"];
const HERO_MODELS = HERO_MODEL_IDS.map((id) => FAMILIES.find((f) => f.id === id)).filter((f): f is Family => f != null);

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
    would waste a third of a small screen on empty space.

    `light` puts a soft key behind the section, alternating side down the page.
    Without it the body below the hero goes flat grey and the shot ends up
    looking like a hat on a spreadsheet. */
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
  const lit = light ? `vg-lit ${light === "end" ? "vg-lit-end" : ""}` : "";
  return (
    /* The rhythm was 56/96. The hero and the closing card both fill a viewport,
       so at that spacing everything between them read as one continuous slab —
       the page had a frame and no chapters. 80/144 is what makes a section
       arrive rather than continue. */
    <section
      {...(id ? { id } : {})}
      className={`relative mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 md:py-36 ${lit} ${className ?? ""}`}
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

/** A title card, not an `h2`.
    Centred headings stacked down a page are the SaaS pattern this redesign is
    trying to get out of. A chapter mark and a rule running off to the side is
    how a film labels a section, and it also does something the centred version
    could not: it tells the reader where they are in the page. */
function Heading({ index, children, sub }: { index: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-9 md:mb-12">
      <div className="flex items-center gap-4">
        {/* Faint, not accent. A slate number is a mark on the page, not something
            to do — and it was spending accent on every section heading, which is
            most of why the pricing viewport ended up with seven blue things and
            no answer to "which button". The vein beside it already carries the
            colour. */}
        <span className="vg-chapter shrink-0 text-[11px] font-semibold" style={{ color: "var(--vg-text-faint)" }} lang="en">
          {index}
        </span>
        {/* The rule reaches away from the mark toward the far edge, so the eye
            is pulled across the section rather than parked on the number. */}
        <hr className="vg-vein min-w-0 flex-1" aria-hidden />
      </div>
      {/* 32/52, up from 26/34.
          A section heading that is only 8px larger than the body around it is
          not a heading, it is a bold paragraph — which is what made the middle
          of this page read as one continuous slab. The reference sites this is
          measured against carry their structure entirely on type scale and
          space, with no boxes at all, and their section headings run to double
          the body size or more. */}
      <h2
        className="mt-4 max-w-[20ch] text-[32px] font-extrabold leading-[1.2] md:text-[52px]"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
      >
        {children}
      </h2>
      {sub && (
        <p className="mt-3 max-w-[54ch] text-[13.5px] leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ---------- nav ---------- */

/** The page's own sections. Anchors, not routes — this is one document. */
const NAV_LINKS: { href: string; label: TKey }[] = [
  { href: "#models", label: "lp_nav_models" },
  { href: "#features", label: "lp_nav_features" },
  { href: "#plans", label: "lp_nav_plans" },
  { href: "#faq", label: "lp_nav_faq" },
];

function TopNav({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /* Glass on arrival, not at rest.
     The bar used to carry its own background from the first frame, which put a
     bordered pill directly on top of the hero card's bordered edge — two frames
     stacked at the top of the screen, each undermining the other. Transparent
     until the page has actually moved, the nav belongs to the shot; once there
     is content sliding under it, the glass earns its keep.

     `scrollY` rather than `scrollYProgress`: a fixed pixel threshold behaves the
     same on a short page and a long one, where a percentage would trigger almost
     immediately on one and far too late on the other. */
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  const linkClass = "vg-ease whitespace-nowrap text-[13px] hover:text-[color:var(--vg-text)]";

  return (
    /* Fixed, not sticky. A sticky header still occupies a row in the flow, and
       the hero is a full-bleed card that has to start at the top of the page —
       sticky would push it down by the height of the bar and break the inset. */
    <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 sm:px-6">
      <div
        /* The blur lives here rather than on any scrolling surface: a
           backdrop-filter over moving content repaints every frame and is the
           usual cause of a landing page that stutters on a phone. */
        className={`vg-ease mx-auto w-full max-w-[1180px] rounded-[1.75rem] pe-2 ps-6 ${scrolled ? "py-2.5" : "py-4"}`}
        style={
          scrolled
            ? {
                background: "var(--vg-glass)",
                backdropFilter: "blur(var(--vg-blur))",
                border: "1px solid var(--vg-border-subtle)",
              }
            : { background: "transparent", border: "1px solid transparent" }
        }
      >
        <div className="flex items-center justify-between gap-6">
          {/* Wordmark over tagline, as the brand sheet sets it. Light weight and
              wide tracking, not the extrabold/tight it was — the logo is the one
              piece of type whose treatment is not ours to choose. */}
          <a href="#" className="flex shrink-0 flex-col leading-none" aria-label={BRAND.name}>
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
          </a>

          {/* The page has four chapters and the bar offered no way into any of
              them. On a document this long that is the nav's actual job; the two
              buttons were doing the whole thing alone. */}
          <nav className="hidden lg:block">
            <ul className="flex items-center gap-7">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={linkClass} style={{ color: "var(--vg-text-secondary)" }}>
                    {t(l.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {/* Outlined, not bare. Two actions with only one of them looking like
                a control reads as "a link and a button" rather than as a second
                and a first choice — the outline is what makes them a pair with a
                clear order. */}
            <button
              onClick={onSignIn}
              className="vg-ease hidden rounded-full px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--vg-surface-overlay)] active:scale-[0.98] sm:block"
              style={{ color: "var(--vg-text-secondary)", border: "1px solid var(--vg-border)" }}
            >
              {t("lp_login")}
            </button>
            <button
              onClick={onSignUp}
              className="vg-ease rounded-full px-5 py-2 text-[13px] font-semibold active:scale-[0.98]"
              style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
            >
              {t("lp_signup")}
            </button>

            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-label={t(open ? "lp_nav_close" : "lp_nav_open")}
              className="vg-ease -me-1 grid size-9 place-items-center rounded-full lg:hidden"
              style={{ color: "var(--vg-text-secondary)" }}
            >
              {open ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
            </button>
          </div>
        </div>

        {/* The links again, stacked, for the widths that cannot show the row.
            Inside the same pill rather than a full-screen overlay: there are four
            of them, and covering the page to show four words is a sheet doing a
            menu's job. */}
        {open && (
          <nav className="mt-4 border-t pt-4 lg:hidden" style={{ borderColor: "var(--vg-border-subtle)" }}>
            <ul className="flex flex-col gap-4">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`${linkClass} block`}
                    style={{ color: "var(--vg-text-secondary)" }}
                  >
                    {t(l.label)}
                  </a>
                </li>
              ))}
              <li className="sm:hidden">
                <button
                  onClick={onSignIn}
                  className="vg-ease w-full rounded-full py-2.5 text-[13px] font-medium"
                  style={{ color: "var(--vg-text-secondary)", border: "1px solid var(--vg-border)" }}
                >
                  {t("lp_login")}
                </button>
              </li>
            </ul>
          </nav>
        )}
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
/**
 * The hero's moving backdrop, once there is one to ship.
 *
 * `null` today, and that is a working state rather than a stub: the frame
 * already carries a designed background — bloom, grain, the subject glow and the
 * vignette over it — so nothing is missing while this is empty, and no request
 * goes out for a file that is not there. The same discipline as
 * `ModelMark`'s SHIPPED_MARKS and the mascot slot above: a name here is somebody
 * saying the asset exists, not a guess that it might.
 *
 * Put the file in `public/brand/` and name it here. It must be a *local* path.
 * The reference this was taken from streams its hero video from a third-party
 * CDN, which is the one thing that cannot come along: an asset on a foreign host
 * is the part of the page most likely to hang for the audience this product is
 * built for, and it would hang behind everything else on the first screen.
 *
 * Keep it short, silent and dark. It plays under type that has to stay readable,
 * which is why it renders at low opacity with the vignette on top rather than at
 * full strength.
 */
const HERO_VIDEO: string | null = null;

function Hero({ onSignUp }: { onSignUp: () => void }) {
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
    /* `overflow-hidden` is load-bearing, and dropping it when this became a card
       is what let the hero's type escape onto the sections below.

       The type block is parallaxed down by up to 44% of the hero's height — that
       is the point, it is the nearest layer — and a transform does not shrink
       the box it moves out of. The old full-bleed hero clipped it, so it never
       showed. A card that does not clip lets the headline slide out of its frame
       and sit on top of the reel, which is exactly what was reported.

       The fade is not a substitute for the clip. `typeFade` reaches zero at 72%
       of the way through the frame, so between there and wherever the transform
       carries it the type is still partly opaque and still outside the card. */
    <div ref={frame} className="relative overflow-hidden">
      {/* THE CARD.
          The reference's defining move, and the reason the marquee alone did not
          make this look like it: the scene is an inset rounded card with a
          hairline edge, not a full-bleed background. `inset-1` leaves a sliver of
          page showing all the way round, so the shot reads as something placed on
          the page rather than as the page itself — which is what lets a 3rem
          corner radius look deliberate instead of like a rounded browser window.

          Everything that used to be a layer of the full-viewport scene lives in
          here now: video, bloom, subject, vignette, grain. They did not change,
          they got a frame. */}
      <div
        className="vg-grain absolute inset-1 overflow-hidden rounded-3xl lg:rounded-[3rem]"
        style={{ border: "1px solid var(--vg-border-subtle)" }}
        aria-hidden
      >
        {/* Furthest back of all, under the key light. Muted, looping and
            `playsInline` — without that last one iOS Safari takes a backgrounded
            decorative video fullscreen on play, which would hand the whole
            screen to something that is meant to be scenery. */}
        {HERO_VIDEO && (
          <video
            src={HERO_VIDEO}
            autoPlay
            loop
            muted
            playsInline
            className="pointer-events-none absolute inset-0 size-full object-cover opacity-40"
          />
        )}

        {/* Key light. Furthest back, so it moves least. */}
        <motion.div style={{ y: lightY }} className="vg-bloom pointer-events-none absolute inset-0" />

        {/* The subject.
            Drawn whether or not the artwork has landed: the glow is the mascot's
            own veins bleeding into the air, and on its own it already reads as
            something standing in the dark. When brand/deev-mascot.png exists it
            drops into this frame with nothing else to change.

            It sits at the far edge rather than the centre now — the type took the
            start of the card, and a subject on the centre line would be standing
            behind the headline instead of beside it. */}
        <motion.div
          style={{ y: subjectY }}
          className="pointer-events-none absolute inset-y-0 bottom-0 end-0 top-[12%] flex w-full items-end justify-end lg:w-[55%]"
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
        <div className="vg-vignette pointer-events-none absolute inset-0" />
      </div>

      {/* THE TYPE, low and at the start edge.
          The reference's `lg:pt-72` is not padding, it is blocking: it drops the
          text into the lower third so the upper two thirds are picture. Centred
          type would fight that — the whole point of the tall top pad is that the
          frame gets to be a frame before the words arrive.

          `text-start` and `lg:ms-0`, never `text-left` and `lg:ml-0`. Under RTL
          the logical properties put the block against the right edge, which is
          the start of the line in Persian; the physical ones would pin it to the
          left and read as a mistake. */}
      <motion.div style={{ y: typeY, opacity: typeFade }} className="relative z-[2] py-24 md:pb-32 lg:pb-36 lg:pt-72">
        <div className="mx-auto flex max-w-[1200px] flex-col px-6 lg:block lg:px-12">
          <motion.div
            variants={riseParent}
            initial="hidden"
            animate="show"
            className="mx-auto max-w-lg text-center lg:mx-0 lg:ms-0 lg:max-w-full lg:text-start"
          >
            <motion.span
              variants={riseItem}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.32em]"
              style={{ color: "var(--vg-text-faint)", fontFamily: "var(--vg-font-latin)" }}
              lang="en"
            >
              <Sparkle size={11} weight="fill" />
              Artificial Intelligence
            </motion.span>

            <motion.h1
              variants={riseItem}
              className="mt-8 max-w-[16ch] text-balance text-[clamp(2.5rem,6.5vw,4.75rem)] font-extrabold leading-[1.08] lg:mt-10"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              {t("lp_hero_title")}
            </motion.h1>

            <motion.p
              variants={riseItem}
              className="mt-8 max-w-[46ch] text-balance text-[15px] leading-[2] md:text-[16.5px]"
              style={{ color: "var(--vg-text-secondary)" }}
            >
              {t("lp_hero_sub")}
            </motion.p>

            {/* Two actions, side by side — the reference's shape.
                The second is deliberately NOT "log in": the nav already carries
                that, two paces above, and a screen offering the same door twice
                has not given anyone a second option. The reference's own second
                button is a demo request, which is the same idea — a smaller ask
                for someone not ready for the first one. Ours goes to the reel,
                because the answer to "is this any good" is the work, and the work
                is already on the page.

                Ghost, not filled, so there is still one obvious answer. */}
            <motion.div
              variants={riseItem}
              className="mt-12 flex flex-col items-center gap-2 sm:flex-row sm:justify-center lg:justify-start"
            >
              <button
                onClick={onSignUp}
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
              <a
                href="#models"
                className="vg-ease flex items-center rounded-full px-6 text-[15px] font-semibold hover:bg-[color:var(--vg-surface-overlay)] active:scale-[0.98]"
                style={{ height: "var(--vg-cta-height)", color: "var(--vg-text-secondary)" }}
              >
                {t("lp_cta_secondary")}
              </a>
            </motion.div>

            <motion.p variants={riseItem} className="mt-5 text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              {t("lp_gift_note").replace("{n}", n(12))}
            </motion.p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The strip under the shot.

   The reference puts a label against a vertical rule and lets the row run off
   the far edge — the shape reads as "these, and more of them" in a way a centred
   caption over a grid does not.

   What it is a strip OF is the part that changes. The original is eight
   companies' logos under "Powering the best teams", which for us would be a
   claim we cannot make and eight trademarks we have no licence to ship — the
   exact thing VendorMark exists in this repo to avoid. The equivalent that is
   both true and a better pitch is the catalogue: these are models you can run
   on this page today, resolved from FAMILIES so the row cannot drift from what
   is actually for sale.
   --------------------------------------------------------------------------- */
function ModelStrip() {
  const { t } = useI18n();
  return (
    <section className="relative pb-2 pt-10 md:pt-14">
      <div className="relative m-auto max-w-[1200px] px-6 lg:px-12">
        <div className="flex flex-col items-center gap-4 md:flex-row md:gap-0">
          {/* The rule is on the *inline end* of the label, which is its left in
              Persian and its right in English — `border-e`, not `border-r`. */}
          <div className="md:max-w-44 md:border-e md:pe-6" style={{ borderColor: "var(--vg-border-subtle)" }}>
            <p className="text-center text-[12.5px] leading-[1.7] md:text-end" style={{ color: "var(--vg-text-muted)" }}>
              {t("lp_models_title")}
            </p>
          </div>

          <div className="relative w-full py-6 md:w-[calc(100%-11rem)]">
            <Marquee seconds={46} label={t("lp_models_title")}>
              {HERO_MODELS.map((f) => (
                <span key={f.id} className="flex shrink-0 items-center gap-2 px-7">
                  <ModelMark familyId={f.id} vendor={f.vendor} size={18} />
                  <span className="whitespace-nowrap text-[13px] font-medium" style={{ color: "var(--vg-text-secondary)" }} lang="en">
                    {f.name}
                  </span>
                </span>
              ))}
            </Marquee>
          </div>
        </div>
      </div>
    </section>
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
  const { t } = useI18n();
  const reel = [...COMMUNITY].sort((a, b) => b.likes - a.likes).slice(0, 8);
  return (
    <Section id="showcase">
      <Heading index="02" sub={t("lp_showcase_sub")}>
        {t("lp_showcase_title")}
      </Heading>

      {/* The strip is no longer decoration, so it is no longer `aria-hidden`.
          It used to be a wall of images with nothing said about them — which is
          the version of this section that proves the least, because a picture
          with no model name attached could have come from anywhere. The caption
          is the section: model, prompt, author.

          Publishing these is what the author agreed to. `consentAt` on every
          record is consent to expose exactly this — the prompt, the settings and
          the reference files — so the prompt is not a detail we are choosing to
          leak, it is the thing they published. */}
      <Rise className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-4 sm:-mx-8 sm:px-8">
        {reel.map((p) => (
          <motion.figure key={p.id} variants={riseItem} className="flex w-[230px] shrink-0 flex-col gap-3 md:w-[280px]">
            <div className="vg-bezel">
              <div className="relative h-[300px] w-full md:h-[360px]">
                <Art family={getFamily(p.familyId)} />
              </div>
            </div>
            <figcaption className="grid gap-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
                <ModelMark familyId={p.familyId} vendor={getFamily(p.familyId)?.vendor ?? ""} size={14} />
                <span lang="en">{getFamily(p.familyId)?.name ?? p.familyId}</span>
              </span>
              {/* The prompt is English in the seed data and will often be
                  English in production too — people paste them from elsewhere —
                  so it carries `dir="ltr"` on its own rather than inheriting the
                  page's RTL and arriving with its punctuation rearranged. */}
              <p className="line-clamp-3 text-[12px] leading-[1.85]" style={{ color: "var(--vg-text-muted)" }} dir="ltr">
                {p.prompt}
              </p>
              <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                {t("lp_showcase_by")} <span lang="en">{p.author}</span>
              </span>
            </figcaption>
          </motion.figure>
        ))}
      </Rise>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   03 — the part you can touch before signing up.

   The obvious version of this section generates something. It cannot: there is
   no generation route yet (`POST /jobs` throws, per docs/API.md), and a visitor
   here has no session to generate with. A box that pretends to run and then asks
   for an account is the worst version of this — it spends the one piece of trust
   the page has.

   So it does the other real thing, and arguably the more useful one for someone
   deciding whether to sign up: it prices the job. Pick a model, describe the
   shot, and the coin cost appears — computed by `minCoinsForFamily` from the
   same committed pricing rows the studio and the plan cards read. Nothing is
   mocked and nothing is a round number chosen to look good.

   That also makes it the section that answers the question this audience
   actually has. "Can it make a video" is not in doubt; "what will it cost me in
   toman" is.
   --------------------------------------------------------------------------- */
function TryIt({ onSignUp }: { onSignUp: () => void }) {
  const { t, n } = useI18n();
  const [familyId, setFamilyId] = useState(HERO_MODEL_IDS[0]!);
  const [prompt, setPrompt] = useState("");
  const promptId = useId();
  const modelId = useId();

  const family = FAMILIES.find((f) => f.id === familyId);
  const coins = family ? minCoinsForFamily(family) : null;
  const written = prompt.trim().length > 0;

  return (
    <Section light="end" id="try">
      <Heading index="03" sub={t("lp_try_sub")}>
        {t("lp_try_title")}
      </Heading>

      <Rise className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <motion.div variants={riseItem} className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor={modelId} className="px-1 text-[12.5px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
              {t("lp_try_model_label")}
            </label>
            <select
              id={modelId}
              value={familyId}
              onChange={(event) => setFamilyId(event.target.value)}
              className="vg-ease w-full rounded-card px-4 py-3.5 text-[14px] outline-none focus:border-accent"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)", color: "var(--vg-text)" }}
            >
              {HERO_MODELS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor={promptId} className="px-1 text-[12.5px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
              {t("lp_try_prompt_label")}
            </label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              placeholder={t("lp_try_placeholder")}
              className="vg-ease w-full resize-none rounded-card px-4 py-3.5 text-[14px] leading-[1.9] outline-none focus:border-accent"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)", color: "var(--vg-text)" }}
            />
          </div>
        </motion.div>

        {/* The price, and it is the only thing in this section that moves.
            `aria-live="polite"` because it changes under a control the reader is
            using but is not next to — a sighted user sees the number update, and
            without this nobody else would know it had. */}
        <motion.div
          variants={riseItem}
          className="grid gap-3 rounded-card p-6 md:w-[280px]"
          style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <span className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
            {t("lp_try_cost")}
          </span>
          <span aria-live="polite" className="flex items-baseline gap-2">
            {!written ? (
              <span className="text-[13px] leading-[1.8]" style={{ color: "var(--vg-text-muted)" }}>
                {t("lp_try_empty")}
              </span>
            ) : coins == null ? (
              <span className="text-[13px] leading-[1.8]" style={{ color: "var(--vg-text-muted)" }}>
                {t("lp_try_cost_na")}
              </span>
            ) : (
              <>
                <span
                  className="text-[38px] font-extrabold leading-none"
                  style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
                >
                  {n(coins)}
                </span>
                <span className="text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
                  {t("lp_try_coins")}
                </span>
              </>
            )}
          </span>

          <button
            onClick={onSignUp}
            disabled={!written}
            className="vg-ease mt-2 rounded-card py-3 text-[13.5px] font-semibold enabled:active:scale-[0.98]"
            style={
              written
                ? { background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }
                : { background: "var(--vg-surface-raised)", color: "var(--vg-text-faint)", cursor: "default" }
            }
          >
            {t("lp_try_cta")}
          </button>
          <span className="text-[11.5px] leading-[1.7]" style={{ color: "var(--vg-text-faint)" }}>
            {t("lp_try_note")}
          </span>
        </motion.div>
      </Rise>
    </Section>
  );
}

/* ---------- one platform, every model ---------- */
function Models() {
  const { t, n } = useI18n();
  const shown = FAMILIES.slice(0, 12);
  return (
    <Section light="start" id="models">
      <Heading index="01" sub={t("lp_models_sub")}>
        {t("lp_models_title")}
      </Heading>
      <Rise className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        {shown.map((f) => {
          const p = minCoinsForFamily(f);
          return (
            <motion.div
              key={f.id}
              variants={riseItem}
              className="vg-ease flex flex-col items-center gap-2 rounded-card p-4 text-center hover:-translate-y-0.5"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
            >
              <VendorMark vendor={f.vendor} size={26} />
              <span className="truncate text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }} lang="en">
                {f.name}
              </span>
              <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                {p == null ? t("home_price_na") : `${t("home_price_from")} ${n(p)}`}
              </span>
            </motion.div>
          );
        })}
      </Rise>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   04 — the comparison, on the one axis that decides it.

   Not a feature matrix. Every service in this market reaches the same models, so
   a row-by-row on capability is a tie that wastes the reader's time and invites
   them to go check. The axis that is not a tie is access: whether someone in
   Iran can pay at all.

   "Services abroad" rather than named competitors. Naming them would mean
   asserting facts about their current behaviour that we do not verify and that
   change without telling us — and the claim does not need a name to land.
   --------------------------------------------------------------------------- */
function Comparison() {
  const { t } = useI18n();
  const rows: { ours: TKey; theirs: TKey }[] = [
    { ours: "lp_vs_pay", theirs: "lp_vs_pay_them" },
    { ours: "lp_vs_vpn", theirs: "lp_vs_vpn_them" },
    { ours: "lp_vs_currency", theirs: "lp_vs_currency_them" },
    { ours: "lp_vs_models", theirs: "lp_vs_models_them" },
    { ours: "lp_vs_lang", theirs: "lp_vs_lang_them" },
  ];
  return (
    <Section light="start" id="compare">
      <Heading index="04" sub={t("lp_vs_sub")}>
        {t("lp_vs_title")}
      </Heading>

      {/* A real table, not a grid of divs. Five rows of two compared values is
          exactly what a table is for, and it is the difference between a screen
          reader announcing "row 3, DEEV: priced in toman" and reading ten
          disconnected fragments. */}
      <Rise>
        <motion.div variants={riseItem} className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-start">
            <thead>
              <tr>
                <th className="w-1/2 px-4 py-4 text-start text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
                  {t("lp_vs_us")}
                </th>
                <th className="w-1/2 px-4 py-4 text-start text-[13px] font-medium" style={{ color: "var(--vg-text-faint)" }}>
                  {t("lp_vs_them")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ours} style={{ borderTop: "1px solid var(--vg-border-subtle)" }}>
                  <td className="px-4 py-5 align-top">
                    <span className="flex items-start gap-2.5 text-[14px] leading-[1.8]" style={{ color: "var(--vg-text-secondary)" }}>
                      {/* The tick carries meaning, so it is not decorative — but
                          the row's own text already says what it says, and an
                          icon repeating it would be announced twice. */}
                      <Check size={15} weight="bold" className="mt-1 shrink-0" style={{ color: "var(--vg-primary)" }} aria-hidden />
                      {t(row.ours)}
                    </span>
                  </td>
                  <td className="px-4 py-5 align-top text-[14px] leading-[1.8]" style={{ color: "var(--vg-text-faint)" }}>
                    {t(row.theirs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </Rise>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   05 — how it works, in the three steps it actually takes.
   --------------------------------------------------------------------------- */
function HowItWorks() {
  const { t, n } = useI18n();
  const steps: { k: TKey; d: TKey }[] = [
    { k: "lp_how_1", d: "lp_how_1_d" },
    { k: "lp_how_2", d: "lp_how_2_d" },
    { k: "lp_how_3", d: "lp_how_3_d" },
  ];
  return (
    <Section light="end" id="how">
      <Heading index="05">{t("lp_how_title")}</Heading>
      {/* An ordered list, because the order is the content. Numbered by the
          list itself rather than by a hand-written glyph, so the count cannot
          drift from the items. */}
      <Rise className="grid gap-12 md:grid-cols-3 md:gap-8">
        {steps.map(({ k, d }, i) => (
          <motion.div key={k} variants={riseItem} className="relative pt-7">
            <hr className="vg-vein absolute inset-x-0 top-0" aria-hidden />
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--vg-text-faint)", fontFamily: "var(--vg-font-display)" }}
              aria-hidden
            >
              {n(i + 1)}
            </span>
            <h3
              className="mt-3 text-[24px] font-bold leading-[1.35] md:text-[28px]"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              {t(k)}
            </h3>
            <p className="mt-4 max-w-[38ch] text-[14px] leading-[2.05]" style={{ color: "var(--vg-text-muted)" }}>
              {t(d)}
            </p>
          </motion.div>
        ))}
      </Rise>
    </Section>
  );
}

/* ---------------------------------------------------------------------------
   07 — trust, placed where the doubt is.

   Straight after the price, because that is where someone stops and asks what
   happens if this goes wrong. Every line here is something the product already
   does — the prices really are computed before submit, publishing really is
   opt-in, expiry really is written in the wallet.

   What is deliberately NOT here: a payment-gateway badge. ZarinPal is "coming
   soon" in our own wallet copy and nothing charges yet, so a gateway logo would
   be the one false claim on a page whose whole argument is that it is honest
   about money. It goes in when payments do.
   --------------------------------------------------------------------------- */
function Trust() {
  const { t } = useI18n();
  const items: { k: TKey; d: TKey }[] = [
    { k: "lp_trust_price", d: "lp_trust_price_d" },
    { k: "lp_trust_own", d: "lp_trust_own_d" },
    { k: "lp_trust_expiry", d: "lp_trust_expiry_d" },
  ];
  return (
    <Section id="trust">
      <Heading index="07">{t("lp_trust_title")}</Heading>
      <Rise className="grid gap-10 md:grid-cols-3 md:gap-8">
        {items.map(({ k, d }) => (
          <motion.div key={k} variants={riseItem} className="relative pt-7">
            <hr className="vg-vein absolute inset-x-0 top-0" aria-hidden />
            <h3 className="text-[19px] font-bold leading-[1.5]" style={{ color: "var(--vg-text)" }}>
              {t(k)}
            </h3>
            <p className="mt-3 max-w-[38ch] text-[13.5px] leading-[2]" style={{ color: "var(--vg-text-muted)" }}>
              {t(d)}
            </p>
          </motion.div>
        ))}
      </Rise>
    </Section>
  );
}

/* ---------- plans ----------
   The two "main" plans, off the same `GET /plans` ladder the buy screen prices
   from. The full ladder lives on that screen; repeating it here would be a
   second place to forget to update, and quoting it from a compiled-in copy
   would be a landing page advertising a price the database has moved on from. */
function Plans({ plans, onSignIn }: { plans: readonly Plan[]; onSignIn: () => void }) {
  const { t, n } = useI18n();
  const [annual, setAnnual] = useState(false);
  const main = plans.filter((p) => p.group === "main").slice(0, 2);
  return (
    <Section light="start" id="plans">
      {/* Heading and billing switch on one row at desktop. Stacked and centred,
          the switch read as a third heading; beside the title it reads as the
          control for what is underneath it, which is what it is. */}
      <div className="mb-9 flex flex-col gap-5 md:mb-12 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <Heading index="06">{t("lp_plans_title")}</Heading>
        </div>
        <div
          className="inline-flex shrink-0 self-start rounded-pill p-1 md:mb-12 md:self-end"
          style={{ background: "var(--vg-surface-raised)" }}
          role="group"
          aria-label={t("lp_plans_title")}
        >
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => setAnnual(v)}
              aria-pressed={annual === v}
              className="vg-ease rounded-pill px-4 py-2 text-[12.5px] font-semibold"
              style={
                // A segmented control, not an action: it changes what you are
                // looking at, it does not commit you to anything. The design
                // system's own rule for this is a raised pill and full-strength
                // text — accent here was a third blue competing with the plan
                // buttons it sits above.
                annual === v
                  ? { background: "var(--vg-surface-overlay)", color: "var(--vg-text)", boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.06)" }
                  : { color: "var(--vg-text-faint)" }
              }
            >
              {v ? t("lp_annual") : t("lp_monthly")}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-[840px] gap-3 md:grid-cols-2">
        {main.map((plan) => (
          <PlanCard key={plan.code} plan={plan} annual={annual} onSignIn={onSignIn} />
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
    /* The recommended plan has to win on more than a badge.
       Two identical accent buttons side by side is a choice with no
       recommendation in it — the eye has nowhere to go, so it goes nowhere. The
       popular card keeps the solid fill and gets its own light behind it; the
       other one drops to an outline. Same information, one obvious answer. */
    <div
      className={`relative flex flex-col rounded-card p-6 md:p-7 ${plan.popular ? "md:-my-3 md:py-10" : ""}`}
      style={{
        background: "var(--vg-surface)",
        border: `1px solid ${plan.popular ? "var(--vg-primary)" : "var(--vg-border-subtle)"}`,
        ...(plan.popular ? { boxShadow: "0 0 60px -12px rgb(var(--vg-primary-rgb) / 0.28)" } : {}),
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
        {n(plan.coinsPerTerm)} {t("lp_coins_month")}
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

      {/* Bottom-aligned, so the two buttons line up even when one card carries a
          discount line the other does not. The padding is on the wrapper because
          `mt-auto` collapses to nothing on a full card and would let the button
          touch the price. */}
      <div className="mt-auto grid pt-7" />
      <button
        onClick={onSignIn}
        className="vg-ease rounded-card py-3.5 text-[13.5px] font-semibold active:scale-[0.98]"
        style={
          plan.popular
            ? {
                background: "var(--vg-primary)",
                color: "var(--vg-text-on-primary)",
                boxShadow: "0 0 32px rgb(var(--vg-primary-rgb) / 0.28), inset 0 1px 0 rgb(255 255 255 / 0.25)",
              }
            : { background: "transparent", color: "var(--vg-text-secondary)", border: "1px solid var(--vg-border)" }
        }
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
    <Section light="end" id="faq">
      <Heading index="08">{t("lp_faq_title")}</Heading>
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
      <hr className="vg-vein absolute inset-x-0 top-0" aria-hidden />
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
            {/* Phone, not email — and the line underneath is why.
                "No password, one verification and you are in" is true of the OTP
                route and false of the email one, which takes a password of at
                least ten characters. This button used to promise passwordless
                email sign-in, which no route has ever served; harmless while it
                went nowhere, and a contradiction the moment /signin existed. */}
            <DeviceMobile size={17} weight="bold" />
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
   11 — the footer.

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
    ],
  },
];

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t px-5 pb-10 pt-14 sm:px-8" style={{ borderColor: "var(--vg-border-subtle)" }}>
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="grid gap-3">
          <span
            className="text-[18px] font-light tracking-[0.34em]"
            style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
          >
            {BRAND.name}
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

      <div
        className="mx-auto mt-10 flex w-full max-w-[1200px] border-t pt-6 text-[11.5px]"
        style={{ borderColor: "var(--vg-border-subtle)", color: "var(--vg-text-faint)" }}
      >
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
export default function Landing({ plans, onSignIn, onSignUp }: { plans: readonly Plan[]; onSignIn: () => void; onSignUp: () => void }) {
  return (
    /* `overflow-x: clip`, not `hidden`. The section lights are meant to spill
       past their section — that overhang is what stops them looking like boxes
       — so something has to stop the spill widening the document. `hidden`
       would do it and would also silently kill the sticky nav, because an
       ancestor with `overflow: hidden` makes `position: sticky` scroll away.
       `clip` trims the paint without creating a scroll container. */
    <div className="relative z-10 min-h-[100dvh] [overflow-x:clip]">
      {/* The eleven-section order. The argument it makes, in sequence: what this
          is → whose models → that they really produce this → what it would cost
          you → why not just use the foreign one → how little there is to it →
          the price → what happens if it goes wrong → the objections → ask again
          → the small print.

          Trust sits directly after pricing on purpose: that is where someone
          stops to ask what happens if this goes wrong, and answering it three
          sections later is answering it to nobody. */}
      <TopNav onSignIn={onSignIn} onSignUp={onSignUp} />
      <Hero onSignUp={onSignUp} />
      <ModelStrip />
      <Models />
      <Reel />
      <TryIt onSignUp={onSignUp} />
      <Comparison />
      <HowItWorks />
      <Plans plans={plans} onSignIn={onSignUp} />
      <Trust />
      <Faq />
      <Closing onSignIn={onSignUp} />
      <Footer />
    </div>
  );
}
