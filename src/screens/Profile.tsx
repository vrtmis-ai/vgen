import { Star, ImagesSquare, Wallet as WalletIcon, CaretLeft, ChatCircleDots, Info, Globe } from "@phosphor-icons/react";
import { getFamily, type Family } from "../data/models";
import type { Generation } from "../lib/gallery";
import { useFavorites } from "../lib/favorites";
import { CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { faNum } from "../lib/format";

// Telegram user info when opened inside Telegram; graceful fallback in browser dev.
function tgUser(): { name: string; username?: string } {
  const u = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
  if (u) return { name: [u.first_name, u.last_name].filter(Boolean).join(" "), username: u.username };
  return { name: "کاربرِ مهمان" };
}

function Row({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-right transition-transform active:scale-[0.99] disabled:opacity-100"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl text-accent" style={{ background: "var(--color-accent-soft)" }}>
        {icon}
      </span>
      <span className="flex-1 t-body">{label}</span>
      {value && <span className="t-caption text-ink3">{value}</span>}
      {onClick && <CaretLeft size={15} className="text-ink3" />}
    </button>
  );
}

export default function Profile({
  coins,
  gens,
  onWallet,
  onGallery,
  onOpenModel,
}: {
  coins: number;
  gens: Generation[];
  onWallet: () => void;
  onGallery: () => void;
  onOpenModel: (familyId: string) => void;
}) {
  const user = tgUser();
  const { favs } = useFavorites();
  const favFamilies = favs.map(getFamily).filter((f): f is Family => Boolean(f));
  const done = gens.filter((g) => g.status === "done").length;

  return (
    <div className="relative z-10 px-4 pt-4">
      {/* header */}
      <div className="mb-6 flex items-center justify-between">
        <span className="t-h1">پروفایل</span>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {/* identity */}
      <div className="mb-6 flex items-center gap-4">
        <span
          className="grid h-16 w-16 place-items-center rounded-full font-display text-[22px] font-semibold text-white"
          style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent2))", boxShadow: "var(--shadow-accent)" }}
        >
          {user.name.slice(0, 1)}
        </span>
        <div>
          <div className="t-h2">{user.name}</div>
          {user.username && <div className="ltr t-caption text-ink3">@{user.username}</div>}
        </div>
      </div>

      {/* stats */}
      <div className="mb-6 grid grid-cols-3 gap-2.5">
        {[
          { n: done, l: "ساخته‌شده" },
          { n: favFamilies.length, l: "مدلِ منتخب" },
          { n: coins, l: "سکه" },
        ].map((s) => (
          <div key={s.l} className="rounded-card border border-line bg-card py-3.5 text-center">
            <div className="font-display text-[20px] font-semibold tabular-nums">{faNum(s.n.toLocaleString("en-US"))}</div>
            <div className="t-caption text-ink3">{s.l}</div>
          </div>
        ))}
      </div>

      {/* favorites */}
      {favFamilies.length > 0 && (
        <div className="mb-6">
          <div className="mb-2.5 t-h2">مدل‌های منتخب</div>
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 no-scrollbar">
            {favFamilies.map((f) => (
              <button key={f.id} onClick={() => onOpenModel(f.id)} className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-card p-1.5 pe-3.5 active:scale-[0.97] transition-transform">
                <span className="relative h-9 w-9 overflow-hidden rounded-xl" style={{ background: f.grad }}>
                  <span className="absolute bottom-0.5 right-0.5"><VendorMark vendor={f.vendor} size={15} /></span>
                </span>
                <span className="text-[12.5px] font-medium">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* menu */}
      <div className="mb-4 divide-y divide-line rounded-bezel border border-line bg-card">
        <Row icon={<WalletIcon size={18} weight="fill" />} label="کیف پول و خرید سکه" onClick={onWallet} />
        <Row icon={<ImagesSquare size={18} weight="fill" />} label="گالریِ من" value={`${faNum(gens.length)} مورد`} onClick={onGallery} />
        <Row icon={<Star size={18} weight="fill" />} label="مدل‌های منتخب" value={faNum(favFamilies.length)} />
      </div>

      <div className="divide-y divide-line rounded-bezel border border-line bg-card">
        <Row icon={<Globe size={18} />} label="زبان" value="فارسی" />
        <Row icon={<ChatCircleDots size={18} />} label="پشتیبانی" value="به‌زودی" />
        <Row icon={<Info size={18} />} label="درباره‌ی Vgen" value="v0.1" />
      </div>
    </div>
  );
}
