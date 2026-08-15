import { ArrowUpRight, Image as ImageIcon, VideoCamera, MusicNote, GraduationCap, Terminal, FilmSlate } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { FEATURED, type FeaturedItem } from "../data/featured";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { PRESETS } from "../data/presets";
import { COURSES, courseMinutes, LEVEL_LABEL, type Course } from "../data/academy";
import { published } from "../data/content";
import { VendorMark } from "../components/VendorMark";
import { faNum } from "../lib/format";
import type { NavKey } from "../components/TopBar";
import { brandPhrase } from "../data/brand";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";

/* ---------------------------------------------------------------------------
   Explore — the reference's signed-in feed, measured section by section.

   Their page is 12,320px of one repeating recipe, and once you see the recipe
   the whole thing is four components:

     SHOWCASE   accent heading, one grey line, a 4-up grid, and a centred pill
                floating over a half-visible next row that fades out behind it
     BANNER     a full-bleed panel: text one side, media the other, one CTA
     SPLIT      a large promo beside a 3x2 grid of small tiles
     STRIP      a tinted bar — title and sub leading, one action trailing

   The page then alternates: showcase, banner, showcase, banner. Content earns
   the grid; marketing gets the banner between them. Fifteen sections, no fifth
   shape.

   The two Persian departures are forced and apply everywhere below. Their
   headings are uppercase, which Persian has no equivalent for, so weight 900
   carries the emphasis. Their accent is legible as type on black and ours is
   not, so accent text uses `--vg-primary-soft` and only fills use
   `--vg-primary`.
   --------------------------------------------------------------------------- */

const art = (seed: string, w = 800, h = 450) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

function Pill({
  children,
  onClick,
  away,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  away?: boolean;
  // `| undefined` is load-bearing under exactOptionalPropertyTypes: Banner
  // forwards its own optional prop, which is present-and-undefined.
  disabled?: boolean | undefined;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-bold transition-transform enabled:active:scale-[0.98] disabled:cursor-default"
      style={
        disabled
          ? { background: "var(--vg-surface-overlay)", color: "var(--vg-text-faint)" }
          : { background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }
      }
    >
      {children}
      {away && !disabled && <ArrowUpRight size={14} weight="bold" />}
    </button>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h2
        className="text-[19px] font-extrabold leading-tight"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-primary-soft)" }}
      >
        {title}
      </h2>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
        {sub}
      </p>
    </div>
  );
}

/**
 * The page's workhorse. A grid, then a second row cut off by a gradient with
 * the "see everything" pill sitting on top of it.
 *
 * The fade is the affordance — it says there is more without spending a row on
 * a label, which is why the reference never writes "load more" anywhere.
 */
function Showcase({
  title,
  sub,
  cta,
  onCta,
  items,
  tease,
  ratio = "16/9",
  cols = "lg:grid-cols-4",
}: {
  title: string;
  sub: string;
  cta: string;
  onCta: () => void;
  items: React.ReactNode[];
  tease: { key: string; seed: string }[];
  ratio?: string;
  cols?: string;
}) {
  return (
    <section>
      <SectionHead title={title} sub={sub} />
      <div className={`grid grid-cols-2 gap-3 ${cols}`}>{items}</div>
      {tease.length > 0 && (
        <div className="relative mt-3">
          <div className={`grid max-h-[120px] grid-cols-2 gap-3 overflow-hidden ${cols}`} aria-hidden>
            {tease.map((t) => (
              <div key={t.key} className="overflow-hidden rounded-xl" style={{ background: "var(--vg-surface)", aspectRatio: ratio }}>
                <img src={art(t.seed)} alt="" loading="lazy" className="size-full object-cover" />
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[120px]"
            style={{ background: "linear-gradient(to bottom, transparent, var(--vg-canvas) 78%)" }}
          />
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <Pill onClick={onCta} away>
              {cta}
            </Pill>
          </div>
        </div>
      )}
    </section>
  );
}

/** Full-bleed panel: copy on one side, media on the other, exactly one action. */
function Banner({
  eyebrow,
  title,
  body,
  cta,
  onCta,
  seed,
  flip,
  ctaDisabled,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
  seed: string;
  flip?: boolean;
  /** The surface is announced but not built. A CTA that navigates somewhere
   *  unrelated is worse than one that plainly says "not yet". */
  ctaDisabled?: boolean;
}) {
  return (
    <div
      className="grid overflow-hidden rounded-2xl md:grid-cols-2"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <div className={`flex flex-col justify-center p-7 md:p-10 ${flip ? "md:order-2" : ""}`}>
        <p className="text-[14px] font-extrabold" style={{ color: "var(--vg-primary-soft)" }}>
          {eyebrow}
        </p>
        {/* h2: a banner is a section of the feed, ranked with the others. */}
        <h2
          className="mt-1 text-[28px] font-extrabold leading-[1.2]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          {title}
        </h2>
        <p className="mt-2.5 max-w-[46ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          {body}
        </p>
        <div className="mt-6">
          <Pill onClick={onCta} away disabled={ctaDisabled}>
            {cta}
          </Pill>
        </div>
      </div>
      <div className={`relative min-h-[220px] ${flip ? "md:order-1" : ""}`}>
        <img src={art(seed, 1000, 620)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        <div className={`absolute inset-0 ${flip ? "vg-banner-fade-flip" : "vg-banner-fade"}`} />
      </div>
    </div>
  );
}

/**
 * What goes in the tile grid: newly-landed models and surfaces that do not have
 * a nav item. Not the modalities.
 *
 * Video / image / audio were in here and they are already the second, third and
 * fourth items of the top bar — a tile that repeats a nav item spends a 396px
 * card to say something the user is already looking at. The reference fills
 * this grid with model drops and features for exactly that reason.
 *
 * "شارژ سکه" is gone from here too. It was reachable from the top bar pill,
 * this tile, the promo panel immediately beside it, and the closing cloud —
 * four buttons for one action, two of them inside the same grid. The pill is
 * persistent chrome and the promo panel is the pricing pitch; the rest was
 * noise. Skills is gone as well: it belongs on the MCP page with the rest of
 * that story, not as a second "به‌زودی" tile next to it.
 */
type Tile = { Icon: typeof ImageIcon; title: string; sub: string; badge?: string; soon?: boolean; go?: (a: Api) => void };
type Api = { onOpen: (f: string, p?: string) => void; onNav: (k: NavKey) => void };

const TILES: Tile[] = [
  { Icon: VideoCamera, title: "Seedance 2.0", sub: "صدا و تصویر با هم، در یک تولید", badge: "جدید", go: (a) => a.onOpen("seedance") },
  { Icon: ImageIcon, title: "Nano Banana", sub: "ویرایش تصویر با دستور متنی", go: (a) => a.onOpen("nano-banana") },
  { Icon: MusicNote, title: "Veo 3.1", sub: "ویدیوی سینمایی گوگل", go: (a) => a.onOpen("veo") },
  { Icon: GraduationCap, title: "آکادمی", sub: "دوره‌های فارسی کار با مدل‌ها", badge: "جدید", go: (a) => a.onNav("academy") },
  // MCP has a page now — it explains the setup and lists the skills. The tile
  // opens it; the actions inside it are still honestly disabled.
  { Icon: Terminal, title: "MCP و مهارت‌ها", sub: "از داخل کلاد و ترمینال بساز", badge: "به‌زودی", go: (a) => a.onNav("mcp") },
  { Icon: FilmSlate, title: "استودیو سینما", sub: "کنترل دوربین، لنز و نور", badge: "به‌زودی", soon: true },
];

export default function Explore({
  onOpen,
  onNav,
  onWallet,
}: {
  onOpen: (familyId: string, prompt?: string) => void;
  onNav: (k: NavKey) => void;
  onWallet: () => void;
}) {
  const families = useCatalogFamilies();
  const getFamily = (id: string) => families.find((family) => family.id === id);
  const posts = COMMUNITY.filter((p) => p.status === "approved");
  // Read admin-editable collections through `published()` — never the raw array.
  // Drafts exist on purpose and must not leak onto a user surface.
  const presets = published(PRESETS);
  const courses = published(COURSES);
  const featured = published(FEATURED);

  const heroCard = (f: FeaturedItem) => (
    <button
      key={f.id}
      onClick={() => (f.familyId ? onOpen(f.familyId, f.prompt) : onNav("video"))}
      className="w-[300px] shrink-0 snap-start text-start md:w-[380px] lg:w-[440px]"
    >
      <div className="overflow-hidden rounded-2xl" style={{ background: "var(--vg-surface)" }}>
        <img src={art(f.seed, 880, 495)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
      </div>
      <p className="mt-2.5 text-[13.5px] font-extrabold" style={{ color: "var(--vg-text)" }}>
        {f.title}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
        {f.subtitle}
      </p>
    </button>
  );

  const projectCard = (p: CommunityPost) => {
    const f = getFamily(p.familyId);
    return (
      <button key={p.id} onClick={() => onOpen(p.familyId, p.prompt)} className="block w-full text-start">
        <div className="overflow-hidden rounded-xl" style={{ background: f?.grad, border: "1px solid var(--vg-border-subtle)" }}>
          <img src={art(p.seed)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          {f && <VendorMark vendor={f.vendor} size={18} />}
          {/* bdi on both Latin runs: without isolation the bidi algorithm
              detaches the "@" from the handle and parks it on the model name. */}
          <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--vg-text)" }}>
            <bdi className="font-bold">{f?.name ?? p.familyId}</bdi>
            <span style={{ color: "var(--vg-text-muted)" }}> · </span>
            <bdi style={{ color: "var(--vg-text-muted)" }}>@{p.author}</bdi>
          </span>
          <span
            className="vg-numeric shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
          >
            {faNum(p.likes.toLocaleString("en-US"))}
          </span>
        </div>
      </button>
    );
  };

  /** Preset cards burn their label onto the art — the whole point is that you
   *  pick one without reading a model name or writing a prompt. */
  const presetCard = (p: (typeof PRESETS)[number]) => (
    <button
      key={p.id}
      onClick={() => onOpen(p.familyId, p.prompt)}
      className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl text-start"
    >
      <img
        src={art(p.seed, 480, 640)}
        alt=""
        loading="lazy"
        className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <span className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.82), transparent 55%)" }} />
      <span className="absolute inset-x-3 bottom-2.5 block">
        <span className="block text-[14px] font-extrabold leading-tight" style={{ color: "var(--vg-text)" }}>
          {p.title}
        </span>
        <span className="mt-0.5 block text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          {getFamily(p.familyId)?.name}
        </span>
      </span>
    </button>
  );

  const courseCard = (c: Course) => (
    <button key={c.id} onClick={() => onNav("academy")} className="block w-full text-start">
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
        <img src={art(c.seed)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
      </div>
      <p className="mt-2 text-[13px] font-bold leading-snug" style={{ color: "var(--vg-text)" }}>
        {c.title}
      </p>
      <p className="mt-1 flex items-center gap-2 text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
        <span>{LEVEL_LABEL[c.level]}</span>
        <span>·</span>
        <span className="vg-numeric">{courseMinutes(c)}</span>
        <span>دقیقه</span>
      </p>
    </button>
  );

  /** The reference closes on a dense cloud of everything it owns. It is the
   *  cheapest possible sitemap and it makes the product look deep.
   *
   *  Models and effects only — the surfaces are all one click away in the top
   *  bar already, and repeating them here is where the duplicate buttons came
   *  from in the first place. */
  const CLOUD = [
    ...families.map((f) => ({ label: f.name, go: () => onOpen(f.id) })),
    ...presets.map((p) => ({ label: p.title, go: () => onOpen(p.familyId, p.prompt) })),
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-20 pt-4"
    >
      {/* The feed opens on the hero carousel, so its first heading was an h2 and
          the document had no h1. Hidden rather than drawn: adding a visible
          title above the carousel would push the thing the page exists to show
          below the fold. */}
      <h1 className="sr-only">اکسپلور</h1>

      <div className="flex flex-col gap-5">
        {/* 1 — hero row */}
        <div className="hide-scrollbar -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {featured.map(heroCard)}
        </div>

        {/* 2 — promo split beside the surface tiles */}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
          <div
            className="flex flex-col justify-center rounded-2xl p-7"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          >
            {/* h2, matching SectionHead. This is a top-level section of the
                feed, and as an h3 directly under the page title it made the
                outline skip a level. */}
            <h2
              className="text-[26px] font-extrabold leading-[1.25]"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              همهٔ مدل‌ها، <span style={{ color: "var(--vg-primary-soft)" }}>یک حساب</span>
            </h2>
            <p className="mt-2 max-w-[42ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
              به‌جای ده اشتراک جدا، با تومان شارژ می‌کنی و فقط بابت چیزی که می‌سازی پول می‌دهی.
            </p>
            <div className="mt-5">
              <Pill onClick={onWallet}>شارژ سکه</Pill>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TILES.map(({ Icon, title, sub, badge, soon, go }) => (
              <button
                key={title}
                disabled={soon}
                onClick={() => go?.({ onOpen, onNav })}
                className="flex min-h-[112px] flex-col rounded-2xl p-4 text-start transition-colors enabled:hover:bg-white/[0.04] disabled:cursor-default"
                style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", opacity: soon ? 0.55 : 1 }}
              >
                <div className="mb-auto flex w-full items-start justify-between">
                  <Icon size={19} style={{ color: "var(--vg-primary-soft)" }} />
                  {badge && (
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                      style={{
                        background: soon ? "var(--vg-surface-overlay)" : "var(--vg-primary-a18)",
                        color: soon ? "var(--vg-text-faint)" : "var(--vg-primary-soft)",
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
                  <bdi>{title}</bdi>
                </p>
                <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                  {sub}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* 3 — banner */}
        <Banner
          eyebrow="Seedance 2.0"
          title="یک صحنهٔ کامل، در یک تولید"
          body="صدا و تصویر با هم ساخته می‌شوند — بدون اینکه لازم باشد بعداً لب‌ها را همگام کنی."
          cta="امتحانش کن"
          onCta={() => onOpen("seedance")}
          seed="vgen-seedance-banner"
        />

        {/* 4 — the presets grid. The entry point for someone who cannot write a
            prompt yet, which is most first-time users. */}
        <Showcase
          title="افکت‌های آماده"
          sub="یک عکس بده، بقیه‌اش با ما. هر افکت یک پرامپت کامل پشتش دارد."
          cta="همهٔ افکت‌ها"
          onCta={() => onNav("effects")}
          items={presets.slice(0, 8).map(presetCard)}
          tease={presets.slice(8, 12).map((p) => ({ key: p.id, seed: p.seed }))}
          ratio="3/4"
        />

        {/* Academy. Slotted right after the presets because they answer the
            same question at two speeds: "I can't write a prompt" gets a card to
            click, then a course to watch. */}
        <Showcase
          title={brandPhrase("آکادمی")}
          sub="دوره‌های کوتاه فارسی برای کار با مدل‌ها. از اولین ویدیو تا فروختن خروجی."
          cta="همهٔ دوره‌ها"
          onCta={() => onNav("academy")}
          items={courses.slice(0, 4).map(courseCard)}
          tease={courses.slice(4, 8).map((c) => ({ key: c.id, seed: c.seed }))}
        />

        {/* 5 — community */}
        <Showcase
          title="داخل هر کار را ببین"
          sub="پرامپت، مدل و تنظیمات هر خروجی باز است. بردار، عوض کن، دوباره بساز."
          cta="کاوش در کامیونیتی"
          onCta={() => onNav("community")}
          items={posts.slice(0, 4).map(projectCard)}
          tease={posts.slice(4, 8).map((p) => ({ key: p.id, seed: p.seed }))}
        />

        {/* 6 — the surface we keep promising. Flipped so two banners in a
            column do not put their media on the same side. */}
        <Banner
          eyebrow="MCP و مهارت‌ها"
          title="از داخل کلاد بساز، نه فقط از سایت"
          body="مدل‌ها را به‌عنوان ابزار به دستیار خودت وصل کن، و جریان‌های چندمرحله‌ای را یک‌بار بنویس و هربار اجرا کن."
          cta="ببین چطور کار می‌کند"
          onCta={() => onNav("mcp")}
          seed="vgen-mcp-banner"
          flip
        />

        {/* 7 — per-model showcase, the shape they repeat for every model */}
        <Showcase
          title="ساخته‌شده با Nano Banana"
          sub="ویرایش تصویر با دستور متنی، بدون ماسک و بدون لایه."
          cta="با Nano Banana بساز"
          onCta={() => onOpen("nano-banana")}
          items={posts.slice(1, 5).map(projectCard)}
          tease={posts.slice(5, 9).map((p) => ({ key: `nb-${p.id}`, seed: `${p.seed}-nb` }))}
        />

        {/* 8 — gift strip */}
        <div
          className="flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: "linear-gradient(135deg, var(--vg-primary-a18), var(--vg-primary-a03))",
            border: "1px solid var(--vg-primary-a18)",
          }}
        >
          <div>
            <p className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
              اولین ساختت مهمان ما
            </p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--vg-text-secondary)" }}>
              سکهٔ هدیه روی حسابت نشسته. لازم نیست کارت بدهی.
            </p>
          </div>
          <Pill onClick={() => onNav("video")}>شروع کن</Pill>
        </div>

        {/* 9 — the closing cloud */}
        <section>
          <SectionHead title="همهٔ امکانات" sub="هر مدل و هر افکتی که داریم، یک کلیک از اینجا." />
          <div className="flex flex-wrap gap-1.5">
            {CLOUD.map((c) => (
              <button
                key={c.label}
                onClick={c.go}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-white/[0.06]"
                style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", color: "var(--vg-text-muted)" }}
              >
                <bdi>{c.label}</bdi>
              </button>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}
