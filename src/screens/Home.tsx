import { motion } from "framer-motion";
import { Star, CaretLeft } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family, type ModelKind } from "../data/models";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { CreditPill } from "../components/chrome";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import { useI18n } from "../lib/i18n";
import type { Wallet } from "../data/wallet";
import { riseItem, riseParent } from "../lib/motion";

/* Built from stitch-export/mobile/vgen-home-persian.html, measured rather than
   eyeballed: hero 40/48 at weight 700, section headings 24 at 600, model cards
   12px radius on a 12px pad and a 12px gutter, page margin 16.

   Two deliberate departures, both because the export is a mockup and this is
   the real app:

   · The rating row ("۴٫۷ ★") is replaced by the model's starting price. We have
     no ratings and inventing them would put a fabricated number on a purchase
     decision; the price is real, and it is what a buyer actually needs there.
   · The nav keeps this app's five destinations. The export's "پروژه‌ها" tab
     has no screen behind it. */

/* ---------- media ---------- */
function Cover({ family, className }: { family?: Family | undefined; className?: string }) {
  const [failed, onError] = useImageFallback();
  const cover = family?.cover;
  return (
    <span className={`absolute inset-0 block ${className ?? ""}`}>
      <span className="absolute inset-0 block" style={{ background: family?.grad ?? "var(--vg-surface-overlay)" }} />
      {cover && isVideoUrl(cover) ? (
        <video src={cover} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : cover && !failed ? (
        <img src={cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={onError} />
      ) : null}
    </span>
  );
}

/* ---------- header ------------------------------------------------------
   Greeting at the inline start, logotype centred, credits at the end. The
   logotype is absolutely positioned so it stays optically centred no matter
   how long the user's name is. */
function TopBar({ wallet, onWallet }: { wallet: Wallet; onWallet: () => void }) {
  const { t } = useI18n();
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b px-4 py-3"
      style={{ background: "var(--vg-glass)", backdropFilter: "blur(var(--vg-blur))", borderColor: "var(--vg-border-subtle)" }}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full" style={{ background: "var(--vg-surface-overlay)" }}>
          <span className="text-[15px] font-semibold" style={{ color: "var(--vg-text-muted)" }}>
            و
          </span>
        </span>
        <span className="text-[13px]" style={{ color: "var(--vg-text-secondary)" }}>
          {t("home_greeting")}
        </span>
      </div>

      <span
        className="pointer-events-none absolute start-1/2 -translate-x-1/2 text-[20px] font-extrabold tracking-tight rtl:translate-x-1/2"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
      >
        VGen
      </span>

      <CreditPill coins={wallet.spendable} onClick={onWallet} />
    </header>
  );
}

/* ---------- hero --------------------------------------------------------
   Typographic, not pictorial. The export leads with a small caps badge, one
   very large line, and a two-line subtitle over empty canvas — the artwork
   below carries the imagery, so the top of the page carries the claim. */
function Hero() {
  const { t } = useI18n();
  return (
    <motion.section variants={riseItem} className="px-4 pb-2 pt-10 text-center">
      <span
        className="inline-block rounded-pill px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ background: "var(--vg-primary-a10)", color: "var(--vg-primary-soft)", fontFamily: "var(--vg-font-latin)" }}
        lang="en"
      >
        Artificial Intelligence
      </span>
      <h1 className="mt-5 text-[40px] font-bold leading-[1.2]" style={{ color: "var(--vg-text)" }}>
        {t("home_hero_title")}
      </h1>
      <p className="mx-auto mt-3 max-w-[34ch] text-[14px] leading-[1.85]" style={{ color: "var(--vg-text-muted)" }}>
        {t("home_hero_sub")}
      </p>
    </motion.section>
  );
}

function SectionHead({ title, onMore }: { title: string; onMore?: (() => void) | undefined }) {
  const { t } = useI18n();
  return (
    <div className="mb-3 flex items-center justify-between px-4">
      <h2 className="text-[24px] font-semibold" style={{ color: "var(--vg-text)" }}>
        {title}
      </h2>
      {onMore && (
        <button onClick={onMore} className="flex items-center gap-0.5 text-[13px] active:scale-95" style={{ color: "var(--vg-primary-soft)" }}>
          {t("home_more_all")}
          <CaretLeft size={13} weight="bold" className="ltr:-scale-x-100" />
        </button>
      )}
    </div>
  );
}

/** A 16:9 clip with its duration stamped in the corner. */
function RecentCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  const secs = 5 + (p.id.charCodeAt(p.id.length - 1) % 8); // stand-in until jobs carry a real duration
  return (
    <motion.button
      variants={riseItem}
      onClick={onOpen}
      className="relative aspect-video w-[248px] shrink-0 overflow-hidden rounded-md text-start active:scale-[0.98] transition-transform"
    >
      <Cover family={f} />
      <span
        className="absolute bottom-2 end-2 rounded-sm px-1.5 py-0.5 text-[11px] tabular-nums"
        style={{ background: "var(--vg-scrim)", color: "var(--vg-text)", fontFamily: "var(--vg-font-mono)" }}
      >
        00:{String(secs).padStart(2, "0")}
      </span>
    </motion.button>
  );
}

/** Square artwork, name, blurb, and what it costs to start. */
function ModelCard({ f, price, onOpen }: { f: Family; price: number | null; onOpen: () => void }) {
  const { t, n } = useI18n();
  return (
    <motion.button
      variants={riseItem}
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-md p-3 text-start active:scale-[0.98] transition-transform"
      style={{ background: "var(--vg-surface-raised)" }}
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-md">
        <Cover family={f} />
      </span>
      <span className="block">
        <span className="block truncate text-[16px] font-bold" style={{ color: "var(--vg-text)" }} lang="en">
          {f.name}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
          {f.blurb}
        </span>
      </span>
      <span className="flex items-center gap-1 text-[13px]" style={{ color: "var(--vg-text-secondary)" }}>
        <Star size={13} weight="fill" style={{ color: "var(--vg-primary)" }} />
        {price == null ? t("home_price_na") : `${t("home_price_from")} ${n(price)}`}
      </span>
    </motion.button>
  );
}

/* ============================================================ */
export default function Home({
  wallet,
  onOpen,
  onModels,
  onCommunity,
  onWallet,
  minPrice,
}: {
  wallet: Wallet;
  onOpen: (familyId: string, prompt?: string) => void;
  onModels: (kind?: ModelKind) => void;
  onCommunity: () => void;
  onWallet: () => void;
  /** Cheapest coin price this family can be run for, or null if unpriceable. */
  minPrice: (f: Family) => number | null;
}) {
  const { t } = useI18n();
  const recent = [...COMMUNITY].sort((a, b) => b.likes - a.likes).slice(0, 6);

  return (
    <motion.div
      variants={riseParent}
      initial="hidden"
      animate="show"
      className="relative z-10"
      style={{ paddingBottom: "calc(var(--nav-h) + 16px)" }}
    >
      <TopBar wallet={wallet} onWallet={onWallet} />
      <Hero />

      <section className="mt-8">
        <SectionHead title={t("home_recent")} onMore={onCommunity} />
        <div className="flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
          {recent.map((p) => (
            <RecentCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
          ))}
        </div>
      </section>

      <section className="mt-9">
        <SectionHead title={t("home_popular")} onMore={() => onModels()} />
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:grid-cols-4">
          {FAMILIES.slice(0, 8).map((f) => (
            <ModelCard key={f.id} f={f} price={minPrice(f)} onOpen={() => onOpen(f.id)} />
          ))}
        </div>
      </section>
    </motion.div>
  );
}
