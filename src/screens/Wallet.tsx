import { ArrowRight, CalendarCheck, Gift, ImageSquare, Lightning, VideoCamera } from "@phosphor-icons/react";
import { PACKS, toman, firstDiscountPct, estImages, estVideos, type CoinPack } from "../data/plans";
import { useI18n } from "../lib/i18n";

const TAG_KEY = { test: "w_tag_test", gift: "w_tag_gift", popular: "w_tag_popular", best: "w_tag_best" } as const;

function TagChip({ pack }: { pack: CoinPack }) {
  const { t } = useI18n();
  if (!pack.tag) return null;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
      style={pack.popular ? { background: "var(--color-accent)", color: "var(--color-on-accent)" } : { background: "var(--color-card2)", color: "var(--color-ink2)" }}
    >
      {t(TAG_KEY[pack.tag])}
    </span>
  );
}

function Estimates({ pack, compact }: { pack: CoinPack; compact?: boolean }) {
  const { t, n } = useI18n();
  return (
    <div className={`flex items-center gap-3 ${compact ? "text-[11px]" : "text-[12px]"} text-ink2`}>
      <span className="flex items-center gap-1">
        <ImageSquare size={compact ? 12 : 14} className="text-accent" />
        {t("w_about")}{n(estImages(pack))} {t("w_est_img")}
      </span>
      <span className="text-ink3">{t("w_est_or")}</span>
      <span className="flex items-center gap-1">
        <VideoCamera size={compact ? 12 : 14} className="text-accent" />
        {t("w_about")}{n(estVideos(pack))} {t("w_est_vid")}
      </span>
    </div>
  );
}

/** Big tiered plan — the money cards, first thing on the screen. */
function PlanCard({ pack }: { pack: CoinPack }) {
  const { t, n, lang } = useI18n();
  const pct = lang === "fa" ? "٪" : "%";
  const total = pack.coins + pack.bonus;
  const payUsd = pack.firstUsd ?? pack.priceUsd;
  const off = firstDiscountPct(pack);
  return (
    <div
      className="flex w-[82%] shrink-0 snap-center flex-col gap-3.5 rounded-bezel border bg-card p-4"
      style={{ borderColor: pack.popular ? "var(--color-accent)" : "var(--color-line)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px] font-semibold tracking-wide text-accent">{pack.name}</span>
        <TagChip pack={pack} />
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[30px] font-semibold leading-none tabular-nums">{n(total)}</span>
          <span className="text-[13px] text-ink2">{t("w_coins")}</span>
        </div>
        {pack.bonus > 0 && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
            <Gift size={12} weight="fill" />
            {n(pack.bonus)} {t("w_gift")}
          </div>
        )}
      </div>

      <Estimates pack={pack} />

      <div className="border-t border-line pt-3">
        {off > 0 && (
          <div className="mb-1 text-[10.5px] text-ink3">
            <s>{n(toman(pack.priceUsd))}</s> · {pct}{n(off)} {t("w_first_off")}
          </div>
        )}
        <button className="btn-accent flex w-full items-center justify-center gap-2 rounded-2xl py-3">
          <span className="text-[15px] font-bold tabular-nums">{n(toman(payUsd))}</span>
          <span className="text-[11px] opacity-80">{t("w_toman")} · {t("w_buy")}</span>
        </button>
        {pack.annualUsdPerMonth != null && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] leading-relaxed text-ink2">
            <CalendarCheck size={12} weight="fill" className="shrink-0 text-accent" />
            {t("w_yearly")} {n(toman(pack.annualUsdPerMonth))} {t("w_toman")} ({t("w_yearly_d")}) — {pct}
            {n(Math.round((1 - pack.annualUsdPerMonth / pack.priceUsd) * 100))} {t("w_less")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small single-price pack — compact grid cell. */
function MiniPack({ pack }: { pack: CoinPack }) {
  const { t, n } = useI18n();
  const total = pack.coins + pack.bonus;
  return (
    <div className="relative flex flex-col gap-2 rounded-card border border-line bg-card p-3.5">
      {pack.tag && <span className="absolute -top-2 start-3"><TagChip pack={pack} /></span>}
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[12.5px] font-semibold tracking-wide text-accent">{pack.name}</span>
        <span className="flex items-baseline gap-1">
          <span className="text-[19px] font-semibold tabular-nums">{n(total)}</span>
          <span className="text-[11px] text-ink2">{t("w_coins")}</span>
        </span>
      </div>
      <Estimates pack={pack} compact />
      <button className="btn-accent mt-0.5 flex items-center justify-center gap-1.5 rounded-xl py-2">
        <span className="text-[12.5px] font-bold tabular-nums">{n(toman(pack.priceUsd))}</span>
        <span className="text-[10px] opacity-80">{t("w_toman")}</span>
      </button>
    </div>
  );
}

export default function Wallet({ coins, onBack }: { coins: number; onBack: () => void }) {
  const { t, n } = useI18n();
  const plans = PACKS.filter((p) => p.firstUsd != null);
  const minis = PACKS.filter((p) => p.firstUsd == null);
  return (
    <div className="relative z-10 min-h-[100dvh] pt-4 pb-10">
      <div className="mb-5 flex items-center gap-3 px-4">
        <button onClick={onBack} aria-label={t("nav_home")} className="grid h-10 w-10 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{t("w_title")}</div>
      </div>

      {/* balance — compact so plans stay above the fold */}
      <div className="mb-6 flex items-center justify-between rounded-bezel border border-line bg-card px-5 py-4 mx-4">
        <span className="text-[12px] text-ink3">{t("w_balance")}</span>
        <span className="flex items-center gap-2">
          <span className="text-ink2 text-[17px]">⬡</span>
          <span className="text-[24px] font-semibold tabular-nums">{n(coins)}</span>
          <span className="text-[13px] text-ink2">{t("w_coins")}</span>
        </span>
      </div>

      {/* main plans first — snap carousel keeps all three discoverable */}
      <div className="mb-2.5 flex items-center gap-1.5 px-4 text-[12.5px] text-ink2">
        <Lightning size={14} weight="fill" className="text-accent" />
        {t("w_plans")}
      </div>
      <div className="mb-7 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
        {plans.map((p) => (
          <PlanCard key={p.id} pack={p} />
        ))}
      </div>

      {/* small packs — one glance, no burying */}
      <div className="mb-2.5 px-4 text-[12.5px] text-ink2">{t("w_packs")}</div>
      <div className="grid grid-cols-2 gap-3 px-4">
        {minis.map((p) => (
          <MiniPack key={p.id} pack={p} />
        ))}
      </div>

      <p className="mt-6 px-4 text-center text-[11px] leading-relaxed text-ink3">
        {t("w_foot1")}
        <br />
        {t("w_foot2")}
      </p>
    </div>
  );
}
