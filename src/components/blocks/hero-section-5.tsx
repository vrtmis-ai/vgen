"use client";

import React from "react";
import { useScroll, motion } from "framer-motion";
import { Menu, X, ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfiniteSlider } from "@/components/ui/infinite-slider";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { ModelMark, hasModelMark } from "@/components/ModelMark";
import { BRAND } from "@/data/brand";
import { FAMILIES } from "@/data/models";
import { effectiveUsd, toman } from "@/data/plans";
import type { Plan } from "@/runtime/contracts/plans";
import { useI18n, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* The Tailark hero-section-5 block, used as given rather than reimplemented.
   Layout, spacing, the inset video card, the nav's scroll behaviour and the
   slider are the original's.

   Four things could not come across verbatim, and each is a correctness fix
   rather than a redesign:

   1. COPY comes from `useI18n`. The page is Persian-first; hardcoded English
      strings would not render for the audience it is built for.
   2. PHYSICAL DIRECTION CLASSES became logical ones — `lg:text-left` → `text-start`,
      `pl-5 pr-3` → `ps-5 pe-3`, `md:border-r md:pr-6` → `md:border-e md:pe-6`.
      On an RTL document the physical versions pin the headline to the left of a
      right-to-left column, which reads as a bug rather than as a layout.
      `ChevronRight` becomes `ChevronLeft` for the same reason: forward is
      leftward in Persian.
   3. THE SLIDER CARRIES OUR MODELS, not the original's eight company logos under
      "Powering the best teams". We do not power those teams — it is a claim we
      cannot make and eight trademarks we have no licence to ship. The catalogue
      is the true equivalent and the better pitch.
   4. `motion/react` → `framer-motion`. Identical API; the repo already ships
      framer-motion, and importing both puts two copies of the same library in
      the bundle.

   The hero video is still the original's imagekit URL. It is a placeholder by
   agreement and has to be replaced with a local asset before this is public:
   a third-party CDN is the part of this page most likely to hang for an
   Iranian visitor, and it sits behind everything else on the first screen. */

const NAV_ITEMS: { label: TKey; href: string }[] = [
  { label: "lp_nav_models", href: "#models" },
  { label: "lp_nav_features", href: "#features" },
  { label: "lp_nav_plans", href: "#plans" },
  { label: "lp_nav_faq", href: "#faq" },
];

/** Cheapest plan by effective monthly price, so the hero's figure follows the ladder. */
/** Cheapest plan on the served ladder, so the hero cannot advertise a price
    the plans section contradicts. A function rather than a module constant:
    the ladder arrives from `GET /plans` at runtime and is not there at import. */
const entryPlan = (plans: readonly Plan[]) => [...plans].sort((a, b) => effectiveUsd(a, false) - effectiveUsd(b, false))[0];

/**
 * Video leads, then image, then audio — the order the hero row uses.
 *
 * Only families that resolve to a real logo. The band exists to borrow
 * recognition, and a monogram borrows none; one lettered tile among eighteen
 * marks reads as a failed image rather than as a choice. Filtered by predicate
 * rather than by an exclusion list, so a model that gains a logo joins on its
 * own and one added without a logo stays out without anyone remembering to.
 */
const SLIDER_MODELS = [
  ...FAMILIES.filter((f) => f.kind === "video"),
  ...FAMILIES.filter((f) => f.kind === "image"),
  ...FAMILIES.filter((f) => f.kind === "audio"),
].filter((f) => hasModelMark(f.id, f.vendor));

export function HeroSection({ plans, onSignIn, onSignUp }: { plans: readonly Plan[]; onSignIn: () => void; onSignUp: () => void }) {
  const ENTRY_PLAN = entryPlan(plans);
  const { t, n, lang } = useI18n();
  const rtl = lang === "fa";

  return (
    <>
      <HeroHeader onSignIn={onSignIn} onSignUp={onSignUp} />
      <main className="overflow-x-hidden">
        {/* `overflow-hidden`, which the original does not need and we do.
            The video card is `absolute inset-1` with an aspect ratio, so its
            height comes from its width — and at a wide viewport that makes it
            taller than the hero's own content, so it hangs down into the section
            below. The original gets away with it because that next section is
            opaque and simply paints over the overflow. Ours is opaque too, which
            is exactly what cut a hard black band across the middle of the video.
            Clipping the card to the hero removes the overflow instead of hiding
            it. */}
        <section className="relative overflow-hidden">
          <div className="py-24 md:pb-32 lg:pb-36 lg:pt-72">
            <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-6 lg:block lg:px-12">
              <div className="mx-auto max-w-lg text-center lg:ms-0 lg:max-w-full lg:text-start">
                <h1
                  className="mt-8 max-w-2xl text-balance text-5xl font-extrabold md:text-6xl lg:mt-16 xl:text-7xl"
                  style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
                >
                  {t("lp_hero_title")}
                </h1>
                <p className="mt-8 max-w-2xl text-balance text-lg leading-[1.9]" style={{ color: "var(--vg-text-secondary)" }}>
                  {t("lp_hero_sub")}
                </p>

                <div className="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-start">
                  <Button
                    onClick={onSignUp}
                    size="lg"
                    className="h-12 rounded-full ps-5 pe-3 text-base font-bold"
                    style={{
                      background: "var(--vg-primary)",
                      color: "var(--vg-text-on-primary)",
                      boxShadow: "0 0 48px rgb(var(--vg-primary-rgb) / 0.35)",
                    }}
                  >
                    <span className="text-nowrap">{t("lp_cta_start")}</span>
                    <ChevronLeft className="ms-1 size-5" />
                  </Button>
                  <Button
                    key={2}
                    asChild
                    size="lg"
                    variant="ghost"
                    className="h-12 rounded-full px-5 text-base hover:bg-white/5"
                    style={{ color: "var(--vg-text-secondary)" }}
                  >
                    <a href="#plans">
                      <span className="text-nowrap">{t("lp_cta_secondary")}</span>
                    </a>
                  </Button>
                </div>

                {/* The entry price, in the hero. Not part of the original block,
                    but part of the brief this replaces: for this audience "what
                    does it cost" is the first question rather than the last.
                    Derived from the cheapest plan the server serves, so the
                    hero cannot advertise a number the plans section contradicts. */}
                <p className="mt-6 text-sm" style={{ color: "var(--vg-text-muted)" }}>
                  {ENTRY_PLAN ? (
                    <a href="#plans" className="duration-150 hover:text-[color:var(--vg-text-secondary)]">
                      {t("lp_hero_from")
                        .replace("{n}", n(toman(effectiveUsd(ENTRY_PLAN, false))))
                        .replace("{c}", n(ENTRY_PLAN.coinsPerTerm))}
                    </a>
                  ) : (
                    t("lp_gift_note").replace("{n}", n(12))
                  )}
                </p>
              </div>
            </div>

            <div
              className="absolute inset-1 aspect-[2/3] overflow-hidden rounded-3xl border sm:aspect-video lg:rounded-[3rem]"
              style={{ borderColor: "var(--vg-border-subtle)" }}
            >
              <video
                autoPlay
                loop
                muted
                playsInline
                className="size-full object-cover opacity-35 lg:opacity-60"
                src="https://ik.imagekit.io/lrigu76hy/tailark/dna-video.mp4?updatedAt=1745736251477"
              ></video>
            </div>
          </div>
        </section>

        <section className="pb-2" id="models" style={{ background: "var(--vg-canvas)" }}>
          <div className="group relative m-auto max-w-7xl px-6">
            <div className="flex flex-col items-center md:flex-row">
              <div className="md:max-w-44 md:border-e md:pe-6" style={{ borderColor: "var(--vg-border-subtle)" }}>
                <p className="text-center text-sm md:text-end" style={{ color: "var(--vg-text-muted)" }}>
                  {t("lp_models_title")}
                </p>
              </div>
              <div className="relative py-6 md:w-[calc(100%-11rem)]">
                {/* No `durationOnHover`, deliberately.
                    The demo passes `speedOnHover` and `speed`, which this
                    component does not accept — they are silently dropped, so the
                    original never enables the hover path at all. Passing the real
                    prop names "fixed" that and broke the loop: on hover it swaps
                    the infinite animation for a ONE-SHOT tween to the end, and
                    when that completes the row simply stops. Which is exactly the
                    "it scrolls past and finishes" you saw. */}
                {/* `reverse` under RTL, and it is the difference between a loop
                    and a row that empties.

                    A flex row in RTL lays its first child at the right edge and
                    the rest leftward, so the track hangs off to the LEFT of the
                    container. `InfiniteSlider` always animates `x` negative,
                    which drags the track further left — away from the only
                    content there is — so once the list has passed, the right
                    side of the band is empty until the loop restarts. Reversing
                    animates from `-contentSize/2` up to `0`, which walks the
                    track rightward through the copy that is already there. */}
                <InfiniteSlider duration={40} gap={112} reverse={rtl}>
                  {SLIDER_MODELS.map((f) => (
                    <div key={f.id} className="flex items-center gap-2.5">
                      <ModelMark familyId={f.id} vendor={f.vendor} size={22} />
                      <span className="whitespace-nowrap text-[15px] font-medium" style={{ color: "var(--vg-text-secondary)" }} lang="en">
                        {f.name}
                      </span>
                    </div>
                  ))}
                </InfiniteSlider>

                {/* Both edges, and both mirrored for RTL.
                    These sit on logical sides (`start-0`/`end-0`) but a CSS
                    gradient angle and ProgressiveBlur's `direction` are both
                    physical, so under RTL they pointed the wrong way: the strip
                    on the right faded from its inner edge outward instead of the
                    reverse, which is why only one end appeared to blur and why
                    the row came out of it early. */}
                <div
                  className="absolute inset-y-0 start-0 w-20"
                  style={{ background: `linear-gradient(${rtl ? "to left" : "to right"}, var(--vg-canvas), transparent)` }}
                />
                <div
                  className="absolute inset-y-0 end-0 w-20"
                  style={{ background: `linear-gradient(${rtl ? "to right" : "to left"}, var(--vg-canvas), transparent)` }}
                />
                <ProgressiveBlur
                  className="pointer-events-none absolute start-0 top-0 h-full w-20"
                  direction={rtl ? "right" : "left"}
                  blurIntensity={1}
                />
                <ProgressiveBlur
                  className="pointer-events-none absolute end-0 top-0 h-full w-20"
                  direction={rtl ? "left" : "right"}
                  blurIntensity={1}
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

const HeroHeader = ({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) => {
  const { t } = useI18n();
  const [menuState, setMenuState] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const { scrollYProgress } = useScroll();

  React.useEffect(() => {
    const unsubscribe = scrollYProgress.on("change", (latest) => {
      setScrolled(latest > 0.05);
    });
    return () => unsubscribe();
  }, [scrollYProgress]);

  return (
    <header>
      <nav data-state={menuState && "active"} className="group fixed z-20 w-full pt-2">
        <div
          className={cn("mx-auto max-w-7xl rounded-3xl px-6 transition-all duration-300 lg:px-12")}
          style={scrolled ? { background: "var(--vg-glass)", backdropFilter: "blur(var(--vg-blur))" } : undefined}
        >
          <motion.div
            key={1}
            className={cn(
              "relative flex flex-wrap items-center justify-between gap-6 py-3 duration-200 lg:gap-0 lg:py-6",
              scrolled && "lg:py-4",
            )}
          >
            <div className="flex w-full items-center justify-between gap-12 lg:w-auto">
              <a href="#" aria-label={BRAND.name} className="flex items-center gap-2">
                <span
                  className="text-[20px] font-light tracking-[0.34em]"
                  style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
                >
                  {BRAND.name}
                </span>
              </a>

              <button
                onClick={() => setMenuState(!menuState)}
                aria-label={t(menuState ? "lp_nav_close" : "lp_nav_open")}
                className="relative z-20 -m-2.5 -me-4 block cursor-pointer p-2.5 lg:hidden"
                style={{ color: "var(--vg-text-secondary)" }}
              >
                <Menu className="m-auto size-6 duration-200 group-data-[state=active]:rotate-180 group-data-[state=active]:scale-0 group-data-[state=active]:opacity-0" />
                <X className="absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 duration-200 group-data-[state=active]:rotate-0 group-data-[state=active]:scale-100 group-data-[state=active]:opacity-100" />
              </button>

              <div className="hidden lg:block">
                <ul className="flex gap-8 text-sm">
                  {NAV_ITEMS.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="block duration-150 hover:text-[color:var(--vg-text)]"
                        style={{ color: "var(--vg-text-muted)" }}
                      >
                        <span>{t(item.label)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div
              className="mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl group-data-[state=active]:block md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none lg:group-data-[state=active]:flex"
              style={{ background: "var(--vg-surface)", borderColor: "var(--vg-border-subtle)" }}
            >
              <div className="lg:hidden">
                <ul className="space-y-6 text-base">
                  {NAV_ITEMS.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        onClick={() => setMenuState(false)}
                        className="block duration-150 hover:text-[color:var(--vg-text)]"
                        style={{ color: "var(--vg-text-muted)" }}
                      >
                        <span>{t(item.label)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                <Button
                  data-testid="landing-login"
                  onClick={onSignIn}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  style={{ borderColor: "var(--vg-border)", color: "var(--vg-text-secondary)", background: "transparent" }}
                >
                  <span>{t("lp_login")}</span>
                </Button>
                <Button
                  data-testid="landing-signup"
                  onClick={onSignUp}
                  size="sm"
                  className="rounded-full font-semibold"
                  style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                >
                  <span>{t("lp_signup")}</span>
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </nav>
    </header>
  );
};
