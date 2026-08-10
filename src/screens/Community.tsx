import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Heart, MagicWand, FilmSlate } from "@phosphor-icons/react";
import { getFamily } from "../data/models";
import { COMMUNITY, type CommunityCategory, type CommunityPost } from "../data/community";
import { VendorMark } from "../components/VendorMark";
import { faNum } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { riseItem, riseParent } from "../lib/motion";

/* ---------------------------------------------------------------------------
   The community wall.

   Measured against /community, which is sectioned rather than filtered — a
   creators row, then shared projects, then shared generations. We keep a filter
   instead of their sections because we have one honest axis to filter on
   (`category`) and no editorial content to fill invented sections with.

   Three fixes here were real bugs, not styling:

   • The trend chips set state that nothing read. Seven controls, none of which
     did anything. They are gone; the categories that replace them are the ones
     actually in the data.
   • Every card drew `family.cover` — the MODEL's picture. Ten posts made with
     the same model were ten copies of one image, which reads as a broken feed
     rather than a community. Each post has its own `seed`; that is the art.
   • Reels had a Remix button. A reel is assembled from several shots outside
     the app, so it has no `sourceGenerationId` and there is nothing to load
     into the studio — the button was a promise the data cannot keep.
   --------------------------------------------------------------------------- */

const art = (seed: string) => `https://picsum.photos/seed/${seed}/600/800`;

const CATEGORY_LABEL: Record<CommunityCategory, string> = {
  image: "تصویر",
  video: "ویدیو",
  reel: "ریل",
};

function PostCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  // A reel is a showcase cut from several jobs. There is no single generation
  // behind it, so there is nothing to recreate — see data/community.ts.
  const recreatable = p.category !== "reel" && !!f;

  return (
    // `group` + the slow scale below: this was the one card surface in the app
    // that did not move under the cursor. Effects, Academy, Explore and MCP all
    // do, so a wall of community work reading as inert was an inconsistency
    // rather than a decision — and on a page whose whole content is other
    // people's images, the image is the thing that should react.
    <motion.div variants={riseItem} className="group mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line">
      <div className="relative w-full" style={{ aspectRatio: `${p.w}/${p.h}`, background: f?.grad }}>
        <img
          src={art(p.seed)}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
        <div className="scrim-media" />

        <div className="absolute start-2.5 top-2.5 flex items-center gap-1.5">
          {f && <VendorMark vendor={f.vendor} size={22} />}
          {p.category === "reel" && (
            <span
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: "rgba(0,0,0,0.55)", color: "#fff", backdropFilter: "blur(6px)" }}
            >
              <FilmSlate size={11} weight="fill" />
              ریل
            </span>
          )}
        </div>

        <div className="absolute inset-x-2.5 bottom-2.5 text-start">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/80">@{p.author}</span>
            <span className="flex items-center gap-1 text-[11px] text-white/80">
              <Heart size={12} weight="fill" className="text-accent" />
              {faNum(p.likes.toLocaleString("en-US"))}
            </span>
          </div>
          <p className="ltr mt-1 line-clamp-2 text-[11.5px] leading-snug text-white/85">{p.prompt}</p>
        </div>
      </div>

      {recreatable ? (
        <button
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-1.5 bg-card py-2.5 text-[12.5px] font-semibold text-accent transition-transform active:scale-[0.98]"
        >
          <MagicWand size={14} weight="fill" />
          بازسازی
          <span className="font-normal text-ink3">
            · <bdi>{f.name}</bdi>
          </span>
        </button>
      ) : (
        <p className="bg-card py-2.5 text-center text-[12px] text-ink3">از چند نما ساخته شده</p>
      )}
    </motion.div>
  );
}

export default function Community({ onOpen }: { onOpen: (familyId: string, prompt?: string) => void }) {
  const { t } = useI18n();
  const [cat, setCat] = useState<CommunityCategory | "all">("all");

  const approved = useMemo(() => COMMUNITY.filter((p) => p.status === "approved"), []);
  const shown = cat === "all" ? approved : approved.filter((p) => p.category === cat);

  // Their "Featured creators" row, built from what we actually have rather than
  // an editorial list: whoever the feed has the most approved work from.
  const creators = useMemo(() => {
    const by = new Map<string, { author: string; posts: number; likes: number; seed: string }>();
    for (const p of approved) {
      const e = by.get(p.author) ?? { author: p.author, posts: 0, likes: 0, seed: p.seed };
      e.posts += 1;
      e.likes += p.likes;
      by.set(p.author, e);
    }
    return [...by.values()].sort((a, b) => b.likes - a.likes).slice(0, 8);
  }, [approved]);

  // Only offer a category that has something behind it. A chip that filters to
  // an empty wall is the same dead control we just removed.
  const cats = (["image", "video", "reel"] as const).filter((c) => approved.some((p) => p.category === c));

  return (
    <div className="relative z-10 mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-16 pt-5 md:px-8">
      <h1 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        {t("com_title")}
      </h1>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
        هرچه اینجاست را صاحبش خودش منتشر کرده. پرامپتش باز است — بردار و عوضش کن.
      </p>

      {/* Featured creators, as theirs has. Horizontal because it is a browse
          strip, not a leaderboard — the ranking is how it is ordered, not
          something worth printing a number for. */}
      {creators.length > 2 && (
        <section className="mt-6">
          <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
            سازنده‌های برتر
          </h2>
          <div className="hide-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 md:mx-0 md:px-0">
            {creators.map((c) => (
              <div
                key={c.author}
                className="flex w-[168px] shrink-0 items-center gap-2.5 rounded-xl p-2.5"
                style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
              >
                <img src={art(c.seed)} alt="" loading="lazy" className="size-9 shrink-0 rounded-full object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold" style={{ color: "var(--vg-text)" }}>
                    @{c.author}
                  </span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                    <span className="vg-numeric">{faNum(String(c.posts))}</span> کار ·{" "}
                    <span className="vg-numeric">{faNum(c.likes.toLocaleString("en-US"))}</span> پسند
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The filter, on the one axis the data actually carries. */}
      <div className="hide-scrollbar -mx-4 my-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        {(["all", ...cats] as const).map((c) => {
          const on = c === cat;
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={on}
              className="h-9 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
              style={{
                background: on ? "rgba(233,95,24,0.14)" : "var(--vg-surface)",
                color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                border: "1px solid var(--vg-border-subtle)",
              }}
            >
              {c === "all" ? "همه" : CATEGORY_LABEL[c]}
            </button>
          );
        })}
        <span className="vg-numeric ms-auto self-center text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
          {faNum(String(shown.length))}
        </span>
      </div>

      {/* Masonry widens with the viewport instead of staying at two phone
          columns on a 1440px window. */}
      <motion.div variants={riseParent} initial="hidden" animate="show" className="[column-fill:_balance] columns-2 gap-3 md:columns-3 xl:columns-4">
        {shown.map((p) => (
          <PostCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
        ))}
      </motion.div>

      {shown.length === 0 && (
        <p className="py-16 text-center text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
          هنوز چیزی در این دسته منتشر نشده.
        </p>
      )}
    </div>
  );
}
