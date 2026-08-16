import { useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowLeft, Check, CaretDown, DeviceMobile, Sparkle } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family } from "../data/models";
import { COMMUNITY } from "../data/community";
import { PLANS, monthlyCoins, toman, annualDiscountPct, effectiveUsd, type Plan } from "../data/plans";
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
    <div ref={frame} className="relative">
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

/* ---------- for tomorrow's creators ---------- */
function Features() {
  const { t } = useI18n();
  const items: { k: TKey; d: TKey }[] = [
    { k: "lp_f1", d: "lp_f1_d" },
    { k: "lp_f2", d: "lp_f2_d" },
    { k: "lp_f3", d: "lp_f3_d" },
  ];
  return (
    <Section light="end">
      <Heading index="02">{t("lp_features_title")}</Heading>
      {/* Three claims, and each one is the answer to a real objection about
          using this from Iran — so they get room to be read rather than being
          three equal boxes skimmed at a glance. Taller cards, a heading that
          carries weight, and they arrive one after another instead of all at
          once, which is what makes a reader take them one at a time. */}
      {/* No cards.
          These were three bordered boxes, and three identical boxes in a row
          read as a table rather than as three claims — which is most of why the
          middle of the page went flat while the hero and the closing did not. A
          box is a weak container: it says "these things are the same kind of
          thing", which the reader already knew. The structure now comes from
          type scale and space, with a hairline seam above each column standing
          in for the border that used to surround it. */}
      <Rise className="grid gap-12 md:grid-cols-3 md:gap-8">
        {items.map(({ k, d }) => (
          <motion.div key={k} variants={riseItem} className="relative pt-7">
            <hr className="vg-vein absolute inset-x-0 top-0" aria-hidden />
            <h3
              className="text-[26px] font-bold leading-[1.35] md:text-[32px]"
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

/* ---------- plans ----------
   Real rows from plans.ts. The landing shows the two "main" plans; the full
   ladder lives on the buy screen, and duplicating it here would be a second
   place to forget to update. */
function Plans({ onSignIn }: { onSignIn: () => void }) {
  const { t, n } = useI18n();
  const [annual, setAnnual] = useState(false);
  const main = PLANS.filter((p) => p.group === "main").slice(0, 2);
  return (
    <Section light="start">
      {/* Heading and billing switch on one row at desktop. Stacked and centred,
          the switch read as a third heading; beside the title it reads as the
          control for what is underneath it, which is what it is. */}
      <div className="mb-9 flex flex-col gap-5 md:mb-12 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <Heading index="03">{t("lp_plans_title")}</Heading>
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
    <Section light="end">
      <Heading index="04">{t("lp_faq_title")}</Heading>
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

/* ============================================================ */
export default function Landing({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  const { t } = useI18n();
  return (
    /* `overflow-x: clip`, not `hidden`. The section lights are meant to spill
       past their section — that overhang is what stops them looking like boxes
       — so something has to stop the spill widening the document. `hidden`
       would do it and would also silently kill the sticky nav, because an
       ancestor with `overflow: hidden` makes `position: sticky` scroll away.
       `clip` trims the paint without creating a scroll container. */
    <div className="relative z-10 min-h-[100dvh] [overflow-x:clip]">
      <TopNav onSignIn={onSignIn} onSignUp={onSignUp} />
      <Hero onSignUp={onSignUp} />
      <ModelStrip />
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
