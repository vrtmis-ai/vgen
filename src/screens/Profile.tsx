import {
  Star,
  ImagesSquare,
  Wallet as WalletIcon,
  CaretLeft,
  ChatCircleDots,
  Info,
  Globe,
  ArrowRight,
  SignOut,
} from "@phosphor-icons/react";
import { getFamily, type Family } from "../data/models";
import type { Generation } from "../lib/gallery";
import { useFavorites } from "../lib/favorites";
import { VendorMark } from "../components/VendorMark";
import { useI18n } from "../lib/i18n";
import type { Wallet } from "../data/wallet";
import type { AccountUser } from "../runtime/contracts/session";

function Row({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition-transform active:scale-[0.99] disabled:opacity-100"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl text-accent" style={{ background: "var(--color-accent-soft)" }}>
        {icon}
      </span>
      <span className="flex-1 t-body">{label}</span>
      {value && <span className="t-caption text-ink3">{value}</span>}
      {onClick && <CaretLeft size={15} className="text-ink3 ltr:-scale-x-100" />}
    </button>
  );
}

export default function Profile({
  account,
  wallet,
  gens,
  onWallet,
  onGallery,
  onOpenModel,
  onSignOut,
}: {
  account: AccountUser;
  wallet: Wallet;
  gens: Generation[];
  onWallet: () => void;
  onGallery: () => void;
  onOpenModel: (familyId: string) => void;
  onSignOut: () => void;
}) {
  const { t, n, lang, setLang } = useI18n();
  const user = account;
  const name = user?.displayName || t("p_guest");
  const { favs } = useFavorites();
  const favFamilies = favs.map(getFamily).filter((f): f is Family => Boolean(f));
  const done = gens.filter((g) => g.status === "done").length;

  return (
    /* Rebuilt for the top-bar shell: no title row with its own CreditPill in it,
       which put a second balance under the one in the chrome. Two columns from
       `md` — identity and stats on one side, the settings lists on the other —
       because a single 640px column of six rows on a 1440px page is a phone
       screenshot, not a desktop layout. */
    <div className="relative z-10 mx-auto w-full max-w-[900px] px-4 pb-16 pt-5 md:px-8">
      <button
        onClick={onGallery}
        className="mb-5 flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold"
        style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
      >
        <ArrowRight size={13} weight="bold" className="ltr:-scale-x-100" />
        بازگشت
      </button>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start">
        <div>
          {/* identity */}
          <div className="mb-6 flex items-center gap-4">
            <span
              className="grid h-16 w-16 place-items-center rounded-full font-display text-[22px] font-semibold"
              style={{ background: "var(--color-accent)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-accent)" }}
            >
              {name.slice(0, 1)}
            </span>
            <div>
              <div className="t-h2">{name}</div>
              {user?.emailNormalized && <div className="ltr t-caption text-ink3">{user.emailNormalized}</div>}
            </div>
          </div>

          {/* stats */}
          <div className="mb-6 grid grid-cols-3 gap-2.5">
            {[
              { v: done, l: t("p_made") },
              { v: favFamilies.length, l: t("p_favs") },
              { v: wallet.spendable, l: t("p_coins") },
            ].map((s) => (
              <div key={s.l} className="rounded-card border border-line bg-card py-3.5 text-center">
                <div className="font-display text-[20px] font-semibold tabular-nums">{n(s.v)}</div>
                <div className="t-caption text-ink3">{s.l}</div>
              </div>
            ))}
          </div>

          {/* favorites */}
          {favFamilies.length > 0 && (
            <div className="mb-6">
              <div className="mb-2.5 t-h2">{t("p_fav_models")}</div>
              <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 no-scrollbar">
                {favFamilies.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => onOpenModel(f.id)}
                    className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-card p-1.5 pe-3.5 active:scale-[0.97] transition-transform"
                  >
                    <span className="relative h-9 w-9 overflow-hidden rounded-xl" style={{ background: f.grad }}>
                      <span className="absolute bottom-0.5 end-0.5">
                        <VendorMark vendor={f.vendor} size={15} />
                      </span>
                    </span>
                    <span className="text-[12.5px] font-medium">{f.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          {/* menu */}
          <div className="mb-4 divide-y divide-line rounded-bezel border border-line bg-card">
            <Row icon={<WalletIcon size={18} weight="fill" />} label={t("p_wallet")} onClick={onWallet} />
            <Row
              icon={<ImagesSquare size={18} weight="fill" />}
              label={t("p_gallery")}
              value={`${n(gens.length)} ${t("p_items")}`}
              onClick={onGallery}
            />
            <Row icon={<Star size={18} weight="fill" />} label={t("p_fav_models")} value={n(favFamilies.length)} />
          </div>

          <div className="divide-y divide-line rounded-bezel border border-line bg-card">
            <Row
              icon={<Globe size={18} />}
              label={t("p_lang")}
              value={lang === "fa" ? "فارسی" : "English"}
              onClick={() => setLang(lang === "fa" ? "en" : "fa")}
            />
            <Row icon={<ChatCircleDots size={18} />} label={t("p_support")} value={t("p_soon")} />
            <Row icon={<Info size={18} />} label={t("p_about")} value="v0.1" />
            <Row icon={<SignOut size={18} />} label={t("p_logout")} onClick={onSignOut} />
          </div>
        </div>
      </div>
    </div>
  );
}
