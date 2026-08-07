import { ArrowUpRight, Image as ImageIcon, VideoCamera, MusicNote, Sparkle, Coins, UsersThree } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { FEATURED, type FeaturedItem } from "../data/featured";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { getFamily } from "../data/models";
import { VendorMark } from "../components/VendorMark";
import { faNum } from "../lib/format";
import type { NavKey } from "../components/TopBar";

/* ---------------------------------------------------------------------------
   Explore — rebuilt against Higgsfield's own signed-in feed, measured in their
   Chrome rather than guessed from the marketing site.

   The page is a stack of full-width panels, 16px page margin, 16px between
   sections, radius 16 on everything. Four section shapes repeat, and the whole
   feed is built out of them:

     1. a scroll row of wide 16:9 cards
     2. a split — one large promo panel beside a grid of small tiles
     3. a full-bleed banner, text on one side and media on the other
     4. a headed grid, with the next row fading out under a centred pill

   Three details carry most of the character, and all three are the opposite of
   what this app was doing:

   · Card metadata sits BELOW the media, not on a scrim over it. Their cards are
     clean rectangles of picture with a caption line underneath. An overlay
     costs contrast on the one thing the card exists to show.

   · Section headings are in the accent colour, not white. Every section opens
     with an accent heading and one grey line of subtitle under it.

   · "See more" is a centred pill floating over a HALF-VISIBLE next row that
     fades out behind it. The fade is the affordance — it says there is more
     without spending a row saying so.

   Persian departures, both forced: their headings are uppercase, which Persian
   has no equivalent for, so weight 900 carries the emphasis instead; and their
   accent is legible as type on black while ours is not, so accent text uses
   `--vg-primary-soft` and only fills use `--vg-primary`.
   --------------------------------------------------------------------------- */

const art = (seed: string, w = 800, h = 450) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/** Accent heading + one grey line. Opens every section on the page. */
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

/** The accent pill. `away` adds the arrow their "go elsewhere" CTAs carry. */
function Pill({ children, onClick, away }: { children: React.ReactNode; onClick?: () => void; away?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-bold transition-transform active:scale-[0.98]"
      style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
    >
      {children}
      {away && <ArrowUpRight size={14} weight="bold" />}
    </button>
  );
}

/** Section 1 — the wide card row. Caption under the media, never on it. */
function HeroRow({ items, onOpen }: { items: FeaturedItem[]; onOpen: (f: FeaturedItem) => void }) {
  return (
    <div className="hide-scrollbar -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      {items.map((f) => (
        <button
          key={f.id}
          onClick={() => onOpen(f)}
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
      ))}
    </div>
  );
}

const TILES: { key: NavKey | "plans"; Icon: typeof ImageIcon; title: string; sub: string; badge?: string }[] = [
  { key: "video", Icon: VideoCamera, title: "ویدیو", sub: "متن یا عکس، تبدیل به ویدیو", badge: "پرکاربرد" },
  { key: "image", Icon: ImageIcon, title: "تصویر", sub: "از یک جمله تا یک عکس" },
  { key: "audio", Icon: MusicNote, title: "صدا", sub: "گویندگی فارسی و انگلیسی" },
  { key: "gallery", Icon: Sparkle, title: "کارهای من", sub: "هرچه ساخته‌ای، یک‌جا" },
  { key: "explore", Icon: UsersThree, title: "کامیونیتی", sub: "ببین بقیه چه می‌سازند" },
  { key: "plans", Icon: Coins, title: "شارژ سکه", sub: "پرداخت ریالی، بدون کارت خارجی" },
];

/** Section 2 — big promo beside the tile grid. */
function PromoSplit({ onNav, onWallet }: { onNav: (k: NavKey) => void; onWallet: () => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
      <div
        className="flex flex-col justify-center rounded-2xl p-7"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
      >
        <h3
          className="text-[26px] font-extrabold leading-[1.25]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          همهٔ مدل‌ها، <span style={{ color: "var(--vg-primary-soft)" }}>یک حساب</span>
        </h3>
        <p className="mt-2 max-w-[42ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          به‌جای ده اشتراک جدا، با تومان شارژ می‌کنی و فقط بابت چیزی که می‌سازی پول می‌دهی.
        </p>
        <div className="mt-5">
          <Pill onClick={onWallet}>شارژ سکه</Pill>
        </div>
      </div>

      {/* Their tiles are 396x126 at radius 16 with a 12px gutter — three across,
          two down. Icon, title, one line, and an optional badge on the end. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TILES.map(({ key, Icon, title, sub, badge }) => (
          <button
            key={title}
            onClick={() => (key === "plans" ? onWallet() : onNav(key))}
            className="flex min-h-[112px] flex-col rounded-2xl p-4 text-start transition-colors hover:bg-white/[0.04]"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <div className="mb-auto flex w-full items-start justify-between">
              <Icon size={19} style={{ color: "var(--vg-primary-soft)" }} />
              {badge && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: "rgba(233,95,24,0.16)", color: "var(--vg-primary-soft)" }}
                >
                  {badge}
                </span>
              )}
            </div>
            <p className="mt-3 text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
              {title}
            </p>
            <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
              {sub}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Section 3 — full-bleed banner, text one side, media the other. */
function Banner({ onOpen }: { onOpen: (familyId: string, prompt?: string) => void }) {
  return (
    <div
      className="grid overflow-hidden rounded-2xl md:grid-cols-2"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <div className="flex flex-col justify-center p-7 md:p-10">
        <p className="text-[15px] font-extrabold" style={{ color: "var(--vg-primary-soft)" }}>
          Seedance 2.0
        </p>
        <h3
          className="mt-1 text-[30px] font-extrabold leading-[1.2]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          یک صحنهٔ کامل، در یک تولید
        </h3>
        <p className="mt-2.5 max-w-[46ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          صدا و تصویر با هم ساخته می‌شوند — بدون اینکه لازم باشد بعداً لب‌ها را همگام کنی.
        </p>
        <div className="mt-6">
          <Pill onClick={() => onOpen("seedance")} away>
            امتحانش کن
          </Pill>
        </div>
      </div>
      <div className="relative min-h-[220px]">
        <img src={art("vgen-seedance-banner", 1000, 620)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        {/* The gradient runs along the inline axis, which has no logical
            direction — so it needs the RTL flip that `dir` will not give it. */}
        <div className="absolute inset-0 vg-banner-fade" />
      </div>
    </div>
  );
}

/** A community card: media, then a caption ROW beneath it. */
function ProjectCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  return (
    <button onClick={onOpen} className="block w-full text-start">
      <div className="overflow-hidden rounded-xl" style={{ background: f?.grad, border: "1px solid var(--vg-border-subtle)" }}>
        <img src={art(p.seed, 800, 450)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {f && <VendorMark vendor={f.vendor} size={18} />}
        {/* Both the model name and the handle are Latin runs inside an RTL line.
            Without isolation the bidi algorithm reorders their punctuation — the
            "@" detaches from the handle and lands against the model name. `bdi`
            is the element for exactly this and needs no direction attribute. */}
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
}

export default function Explore({
  onOpen,
  onNav,
  onWallet,
}: {
  onOpen: (familyId: string, prompt?: string) => void;
  onNav: (k: NavKey) => void;
  onWallet: () => void;
}) {
  const posts = COMMUNITY.filter((p) => p.status === "approved");
  const firstRow = posts.slice(0, 4);
  const teaseRow = posts.slice(4, 8);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-20 pt-4">
      <div className="flex flex-col gap-4">
        <HeroRow items={FEATURED} onOpen={(f) => (f.familyId ? onOpen(f.familyId, f.prompt) : onNav("video"))} />

        <PromoSplit onNav={onNav} onWallet={onWallet} />

        <Banner onOpen={onOpen} />

        <section>
          <SectionHead title="داخل هر کار را ببین" sub="پرامپت، مدل و تنظیمات هر خروجی باز است. بردار، عوض کن، دوباره بساز." />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {firstRow.map((p) => (
              <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
            ))}
          </div>

          {/* The tease row: a second row cut off by a fade, with the pill sitting
              on top of it. The fade is what says "there is more" — no label. */}
          <div className="relative mt-3">
            <div className="grid max-h-[130px] grid-cols-2 gap-3 overflow-hidden lg:grid-cols-4" aria-hidden>
              {teaseRow.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-xl" style={{ background: getFamily(p.familyId)?.grad }}>
                  <img src={art(p.seed, 800, 450)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[130px]"
              style={{ background: "linear-gradient(to bottom, transparent, var(--vg-canvas) 78%)" }}
            />
            <div className="absolute inset-x-0 bottom-0 flex justify-center">
              <Pill onClick={() => onNav("gallery")} away>
                کاوش در کامیونیتی
              </Pill>
            </div>
          </div>
        </section>

        {/* Section 5 — the contest strip: title and sub on the leading side, a
            single action on the trailing side, on a tinted panel. */}
        <div
          className="flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: "linear-gradient(135deg, rgba(233,95,24,0.16), rgba(233,95,24,0.03))",
            border: "1px solid rgba(233,95,24,0.22)",
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
      </div>
    </motion.div>
  );
}
