import { useId, useState } from "react";
import { motion } from "framer-motion";
import { Check, CaretDown, DeviceMobile } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family } from "../data/models";
import { COMMUNITY } from "../data/community";
import { PLANS, monthlyCoins, toman, annualDiscountPct, effectiveUsd, type Plan } from "../data/plans";
import { minCoinsForFamily } from "../data/pricing";
import { HeroSection } from "../components/blocks/hero-section-5";
import { ModelMark } from "../components/ModelMark";
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
                <ModelMark vendor={getFamily(p.familyId)?.vendor ?? ""} size={14} />
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

/* ---------------------------------------------------------------------------
   01 — one platform, every model.

   A travelling band rather than a grid of tiles. The grid was the more literal
   answer — nineteen cards, grouped, each with its price — and it was the wrong
   one: a wall of boxes reads as an inventory, and the claim here is not "we have
   a list", it is "the names you already trust are all in one place". A row that
   keeps arriving says that; a table that ends says the opposite.

   All nineteen ride the band, not a curated nine, so the count above it stays
   true. Logo and name only — the per-model price lives in section 03, where
   somebody is actually choosing, and putting it here would make each item wide
   enough that the band stops reading as a band.

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
   Real rows from plans.ts. The landing shows the two "main" plans; the full
   ladder lives on the buy screen, and duplicating it here would be a second
   place to forget to update. */
function Plans({ onSignIn }: { onSignIn: () => void }) {
  const { t, n } = useI18n();
  const [annual, setAnnual] = useState(false);
  const main = PLANS.filter((p) => p.group === "main").slice(0, 2);
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
export default function Landing({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
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
      {/* Nav, hero and the model band come from the Tailark block as given —
          `src/components/blocks/hero-section-5.tsx`. It carries its own header,
          so there is no TopNav here, and its slider is the model wall, so there
          is no separate Models section either. What could not come across
          verbatim is listed at the top of that file. */}
      <HeroSection onSignIn={onSignIn} onSignUp={onSignUp} />
      <Reel />
      <TryIt onSignUp={onSignUp} />
      <Comparison />
      <HowItWorks />
      <Plans onSignIn={onSignUp} />
      <Trust />
      <Faq />
      <Closing onSignIn={onSignUp} />
      <Footer />
    </div>
  );
}
