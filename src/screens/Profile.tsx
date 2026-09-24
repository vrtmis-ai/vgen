import { useState, type FormEvent } from "react";
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
import { useAuth } from "../features/session/useAuth";
import { ApiError } from "../runtime/apiError";
import { HandleSchema } from "../runtime/contracts/session";
import type { Family } from "../data/models";
import { useFamilyLookup } from "../features/catalog/CatalogProvider";
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
  onBack,
  onGallery,
  onOpenModel,
  onSignOut,
}: {
  account: AccountUser;
  wallet: Wallet;
  gens: Generation[];
  onWallet: () => void;
  /* Two props, because they were one and it sent people to the wrong screen.

     "My gallery" and "Back" both called `onGallery`, which the page bound to
     `goBack`. On a cold load of /profile there is nothing behind it, so
     `goBack` falls through to its last-workspace default — /studio/video — and
     the row labelled "my gallery" opened the video studio. */
  onBack: () => void;
  onGallery: () => void;
  onOpenModel: (familyId: string) => void;
  onSignOut: () => void;
}) {
  const { t, n, lang, setLang } = useI18n();
  const familyOf = useFamilyLookup();
  const user = account;
  const name = user?.displayName || t("p_guest");
  const { favs } = useFavorites();
  const favFamilies = favs.map(familyOf).filter((f): f is Family => Boolean(f));
  const done = gens.filter((g) => g.status === "done").length;

  return (
    /* Rebuilt for the top-bar shell: no title row with its own CreditPill in it,
       which put a second balance under the one in the chrome. Two columns from
       `md` — identity and stats on one side, the settings lists on the other —
       because a single 640px column of six rows on a 1440px page is a phone
       screenshot, not a desktop layout. */
    <div className="relative z-10 mx-auto w-full max-w-[900px] px-4 pb-16 pt-5 md:px-8">
      <button
        onClick={onBack}
        className="mb-5 flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold"
        style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
      >
        <ArrowRight size={13} weight="bold" className="ltr:-scale-x-100" />
        بازگشت
      </button>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start">
        <div>
          {/* identity */}
          <Identity user={user} name={name} />

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

/**
 * Who you are, and the one place you can change it.
 *
 * Nothing about an account was editable before this: every field on `users` was
 * written once at sign-up and never again, so somebody who mistyped their name
 * at the door lived with it. The username matters more than the display name,
 * because it is what the community feed credits shares by.
 */
function Identity({ user, name }: { user: AccountUser; name: string }) {
  const { t } = useI18n();
  const { updateProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(user.handle);
  const [displayName, setDisplayName] = useState(user.displayName ?? "");

  // The same rule the server applies, so an impossible name is refused before
  // the round trip rather than after it.
  const handleOk = HandleSchema.safeParse(handle).success;
  const moved = handle.trim().toLowerCase() !== user.handle || displayName.trim() !== (user.displayName ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!handleOk || !moved) return;
    updateProfile.mutate(
      {
        ...(handle.trim().toLowerCase() === user.handle ? {} : { handle: handle.trim().toLowerCase() }),
        ...(displayName.trim() === (user.displayName ?? "") ? {} : { displayName: displayName.trim() }),
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (!editing) {
    return (
      <div className="mb-6 flex items-center gap-4">
        <span
          className="grid h-16 w-16 place-items-center rounded-full font-display text-[22px] font-semibold"
          style={{ background: "var(--color-accent)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-accent)" }}
        >
          {name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <div className="t-h2">{name}</div>
          <div className="ltr t-caption text-accent">@{user.handle}</div>
          {user.emailNormalized && <div className="ltr t-caption text-ink3">{user.emailNormalized}</div>}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="ms-auto shrink-0 rounded-xl border border-line px-3 py-1.5 t-caption active:scale-[0.98]"
        >
          {t("p_edit")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 grid gap-2.5 rounded-bezel border border-line bg-card p-3.5">
      <label className="grid gap-1 t-caption text-ink3">
        {t("auth_handle_label")}
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          aria-label={t("auth_handle_label")}
          autoComplete="username"
          minLength={3}
          maxLength={24}
          dir="ltr"
          className="h-10 rounded-xl border border-line bg-transparent px-3 t-body"
        />
      </label>
      <label className="grid gap-1 t-caption text-ink3">
        {t("p_display_name")}
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          aria-label={t("p_display_name")}
          maxLength={80}
          className="h-10 rounded-xl border border-line bg-transparent px-3 t-body"
        />
      </label>

      {!handleOk && handle.length > 0 && (
        <p role="alert" className="t-caption" style={{ color: "var(--vg-danger)" }}>
          {t("auth_err_handle_invalid")}
        </p>
      )}
      {updateProfile.error && (
        <p role="alert" className="t-caption" style={{ color: "var(--vg-danger)" }}>
          {t(
            updateProfile.error instanceof ApiError && updateProfile.error.code === "handle_taken"
              ? "auth_err_handle_taken"
              : "auth_err_generic",
          )}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!handleOk || !moved || updateProfile.isPending}
          className="rounded-xl bg-accent px-3.5 py-2 t-caption font-semibold text-on-accent disabled:opacity-40"
        >
          {updateProfile.isPending ? t("p_edit_saving") : t("p_edit_save")}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setHandle(user.handle);
            setDisplayName(user.displayName ?? "");
            updateProfile.reset();
          }}
          className="rounded-xl border border-line px-3.5 py-2 t-caption"
        >
          {t("p_edit_cancel")}
        </button>
      </div>
    </form>
  );
}
