import { ArrowRight, Gift, Lightning } from "@phosphor-icons/react";
import { PACKS, tomanPrice, type CoinPack } from "../data/plans";
import { faNum } from "../lib/format";

function PackCard({ pack }: { pack: CoinPack }) {
  const total = pack.coins + pack.bonus;
  const toman = tomanPrice(pack.coins);
  return (
    <div className={`relative rounded-bezel border bg-card p-4 ${pack.popular ? "border-ink/40" : "border-line"}`}>
      {pack.tag && (
        <span
          className={`absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
            pack.popular ? "bg-ink text-bg" : "bg-card2 text-ink2"
          }`}
        >
          {pack.tag}
        </span>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-semibold tabular-nums">{faNum(total.toLocaleString("en-US"))}</span>
            <span className="text-[13px] text-ink2">سکه</span>
          </div>
          {pack.bonus > 0 && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400">
              <Gift size={12} weight="fill" />
              {faNum(pack.bonus)} سکه هدیه
            </div>
          )}
        </div>
        <button className="flex flex-col items-center rounded-2xl bg-ink px-4 py-2.5 text-bg active:scale-95 transition-transform">
          <span className="text-[13px] font-semibold tabular-nums">{faNum(toman.toLocaleString("en-US"))}</span>
          <span className="text-[10px] opacity-70">تومان · خرید</span>
        </button>
      </div>
    </div>
  );
}

export default function Wallet({ coins, onBack }: { coins: number; onBack: () => void }) {
  return (
    <div className="relative z-10 min-h-[100dvh] px-4 pt-4 pb-10">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" />
        </button>
        <div className="text-[15px] font-medium">کیف پول</div>
      </div>

      {/* balance */}
      <div className="mb-6 rounded-bezel border border-line bg-card p-5">
        <div className="text-[12px] text-ink3">موجودیِ تو</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-ink2 text-[20px]">⬡</span>
          <span className="text-[30px] font-semibold tabular-nums">{faNum(coins.toLocaleString("en-US"))}</span>
          <span className="text-[14px] text-ink2">سکه</span>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1.5 text-[12.5px] text-ink2">
        <Lightning size={14} weight="fill" />
        خرید سکه
      </div>

      <div className="flex flex-col gap-3.5">
        {PACKS.map((p) => (
          <PackCard key={p.id} pack={p} />
        ))}
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-ink3">
        پرداخت با کارت بانکی از طریق زرین‌پال (به‌زودی فعال می‌شود).
        <br />
        سکه‌ها برای ساختِ تصویر و ویدیو با مدل‌ها خرج می‌شوند.
      </p>
    </div>
  );
}
