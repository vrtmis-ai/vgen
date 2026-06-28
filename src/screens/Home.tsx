import { Star, Sparkle, ArrowRight } from "@phosphor-icons/react";
import { getFamily, type Family } from "../data/models";
import { EXPLORE } from "../data/explore";
import { useFavorites } from "../lib/favorites";
import { Logo, CreditPill } from "../components/chrome";

function FavChip({ f, onOpen }: { f: Family; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-card p-1.5 pe-3.5 active:scale-[0.97] transition-transform"
    >
      <span className="h-9 w-9 rounded-xl" style={{ background: f.grad }} />
      <span className="text-[12.5px] font-medium">{f.name}</span>
    </button>
  );
}

function ExploreCard({ familyId, prompt, seed, w, h, onOpen }: { familyId: string; prompt: string; seed: string; w: number; h: number; onOpen: () => void }) {
  const f = getFamily(familyId);
  const H = Math.round((400 * h) / w);
  return (
    <button onClick={onOpen} className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line text-right active:scale-[0.98] transition-transform">
      <div className="relative w-full" style={{ aspectRatio: `${w}/${h}` }}>
        <img
          src={`https://picsum.photos/seed/${seed}/400/${H}`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          style={{ background: f?.grad }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78), transparent 55%)" }} />
        <div className="absolute inset-x-2.5 bottom-2.5">
          {f && <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">{f.name}</span>}
          <p className="ltr mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-white/85">{prompt}</p>
        </div>
      </div>
    </button>
  );
}

export default function Home({
  coins,
  onOpen,
  onAllModels,
}: {
  coins: number;
  onOpen: (familyId: string, prompt?: string) => void;
  onAllModels: () => void;
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
        <CreditPill coins={coins} />
      </div>

      {/* favorites */}
      <div className="mb-5">
        <div className="mb-2.5 text-[12.5px] text-ink2">میانبرهای تو</div>
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
            توی «مدل‌ها» روی ستاره‌ی هرکدوم بزن تا این‌جا میانبرش بسازی
          </button>
        )}
      </div>

      {/* explore */}
      <div className="mb-5">
        <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-ink2">
          <Sparkle size={14} weight="fill" />
          الهام بگیر
        </div>
        <div className="[column-fill:_balance] columns-2 gap-3">
          {EXPLORE.map((e) => (
            <ExploreCard key={e.id} {...e} onOpen={() => onOpen(e.familyId, e.prompt)} />
          ))}
        </div>
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
