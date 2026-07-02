import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Star, ArrowRight, PlayCircle } from "@phosphor-icons/react";
import { getFamily, type Family } from "../data/models";
import { FEATURED, type FeaturedItem } from "../data/featured";
import { useFavorites } from "../lib/favorites";
import { Logo, CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl } from "../lib/format";

const KIND_LABEL: Record<FeaturedItem["kind"], string> = {
  model: "New model",
  template: "Template",
  feature: "New",
};

// branded media: real cover image if available, else the model's gradient with a
// slow moving light — intentional and on-brand, never a random stock photo.
function CoverMedia({ family }: { family?: Family }) {
  const cover = family?.cover;
  return (
    <>
      <div className="absolute inset-0" style={{ background: family?.grad ?? "#1d1d21" }} />
      {cover && isVideoUrl(cover) ? (
        <video src={cover} autoPlay muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
      ) : cover ? (
        <motion.img
          src={cover}
          alt=""
          initial={{ scale: 1.06 }}
          animate={{ scale: 1.18 }}
          transition={{ duration: 5.2, ease: "linear" }}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      ) : (
        <motion.div
          className="absolute inset-0"
          style={{ background: "radial-gradient(55% 55% at 30% 25%, rgba(255,255,255,0.28), transparent 70%)" }}
          initial={{ scale: 1, opacity: 0.55 }}
          animate={{ scale: 1.35, opacity: 0.9 }}
          transition={{ duration: 5, ease: "linear" }}
        />
      )}
    </>
  );
}

function ExploreCover({ items, onOpen }: { items: FeaturedItem[]; onOpen: (familyId: string, prompt?: string) => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % items.length), 4200);
    return () => clearInterval(id);
  }, [items.length]);

  const item = items[i]!;
  const f = item.familyId ? getFamily(item.familyId) : undefined;
  const isVideo = f?.kind === "video";

  return (
    <div className="relative h-[210px] w-full overflow-hidden rounded-bezel border border-line">
      <AnimatePresence>
        <motion.button
          key={item.id}
          onClick={() => item.familyId && onOpen(item.familyId, item.prompt)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          className="absolute inset-0 block text-right"
        >
          <CoverMedia family={f} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.05) 65%)" }} />
          <div className="absolute right-4 top-4 flex items-center gap-1.5">
            {isVideo && <PlayCircle size={18} weight="fill" className="text-white/90" />}
            <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] font-medium text-ink backdrop-blur-sm">{KIND_LABEL[item.kind]}</span>
          </div>
          <div className="absolute inset-x-4 bottom-5 flex items-center gap-2.5">
            {f && <VendorMark vendor={f.vendor} size={30} />}
            <div>
              <div className="text-[18px] font-semibold leading-tight text-white">{item.title}</div>
              <div className="mt-0.5 line-clamp-1 text-[12px] text-white/75">{item.subtitle}</div>
            </div>
          </div>
        </motion.button>
      </AnimatePresence>
      <div className="pointer-events-none absolute bottom-3.5 left-4 flex gap-1.5">
        {items.map((_, idx) => (
          <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
        ))}
      </div>
    </div>
  );
}

function FavChip({ f, onOpen }: { f: Family; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-card p-1.5 pe-3.5 active:scale-[0.97] transition-transform"
    >
      <span className="relative h-9 w-9 overflow-hidden rounded-xl" style={{ background: f.grad }}>
        <span className="absolute bottom-0.5 right-0.5">
          <VendorMark vendor={f.vendor} size={15} />
        </span>
      </span>
      <span className="text-[12.5px] font-medium">{f.name}</span>
    </button>
  );
}

export default function Home({
  coins,
  onOpen,
  onAllModels,
  onWallet,
}: {
  coins: number;
  onOpen: (familyId: string, prompt?: string) => void;
  onAllModels: () => void;
  onWallet: () => void;
}) {
  const { favs } = useFavorites();
  const favFamilies = favs.map(getFamily).filter((f): f is Family => Boolean(f));

  return (
    <div className="relative z-10 px-4 pt-4">
      {/* header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink">
          <Logo size={26} animate />
          <span className="text-[19px] font-semibold tracking-tight">Vgen</span>
        </div>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {/* explore cover */}
      <div className="mb-6">
        <div className="mb-3 text-[13px] font-semibold tracking-tight">Explore</div>
        <ExploreCover items={FEATURED} onOpen={onOpen} />
      </div>

      {/* favorites */}
      <div className="mb-6">
        <div className="mb-2.5 text-[13px] font-semibold tracking-tight">Favorites</div>
        {favFamilies.length > 0 ? (
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 no-scrollbar">
            {favFamilies.map((f) => (
              <FavChip key={f.id} f={f} onOpen={() => onOpen(f.id)} />
            ))}
          </div>
        ) : (
          <button
            onClick={onAllModels}
            className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-line2 bg-card2/40 px-3.5 py-3 text-[11.5px] text-ink3 active:scale-[0.99]"
          >
            <Star size={15} />
            توی «مدل‌ها» روی ستاره‌ی هرکدوم بزن تا این‌جا بیاد
          </button>
        )}
      </div>

      {/* all models */}
      <button
        onClick={onAllModels}
        className="flex w-full items-center justify-between rounded-bezel border border-line bg-card px-4 py-3.5 active:scale-[0.99] transition-transform"
      >
        <span className="text-[13.5px] font-medium">دیدن همه‌ی مدل‌ها</span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-card2">
          <ArrowRight size={16} weight="bold" className="-scale-x-100" />
        </span>
      </button>
    </div>
  );
}
