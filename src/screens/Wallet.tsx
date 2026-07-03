import { ArrowRight, CalendarCheck, Gift, Lightning } from "@phosphor-icons/react";
import { PACKS, toman, firstDiscountPct, type CoinPack } from "../data/plans";
import { faNum } from "../lib/format";

const t = (usd: number) => faNum(toman(usd).toLocaleString("en-US"));

function PackCard({ pack }: { pack: CoinPack }) {
  const total = pack.coins + pack.bonus;
  const tiered = pack.firstUsd != null;
  const payUsd = pack.firstUsd ?? pack.priceUsd;
  const off = firstDiscountPct(pack);
  return (
    <div className="relative rounded-bezel border bg-card p-4" style={{ borderColor: pack.popular ? "var(--color-accent)" : "var(--color-line)" }}>
      {pack.tag && (
        <span
          className="absolute -top-2.5 right-4 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
          style={pack.popular ? { background: "var(--color-accent2)", color: "#fff" } : { background: "var(--color-card2)", color: "var(--color-ink2)" }}
        >
          {pack.tag}
        </span>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-[13px] font-semibold tracking-wide" style={{ color: "var(--color-accent)" }}>
            {pack.name}
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
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
        <div className="flex flex-col items-end gap-1">
          {tiered && (
            <span className="text-[10.5px] text-ink3">
              <s>{t(pack.priceUsd)}</s> · ٪{faNum(off)} تخفیف خرید اول
            </span>
          )}
          <button className="btn-accent flex flex-col items-center rounded-2xl px-4 py-2.5">
            <span className="text-[13px] font-semibold tabular-nums">{t(payUsd)}</span>
            <span className="text-[10px] opacity-80">تومان · خرید</span>
          </button>
        </div>
      </div>
      {pack.annualUsdPerMonth != null && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5 text-[11px] text-ink2">
          <CalendarCheck size={13} weight="fill" style={{ color: "var(--color-accent)" }} />
          سالانه: ماهی {t(pack.annualUsdPerMonth)} تومان (پرداخت یکجای ۱۲ ماه) — ٪{faNum(Math.round((1 - pack.annualUsdPerMonth / pack.priceUsd) * 100))} کمتر از قیمت عادی
        </div>
      )}
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
