import { useState, type FormEvent } from "react";
import { ModelMark } from "../components/ModelMark";
import { ImagesSquare, Wallet as WalletIcon, CaretLeft, Globe, ArrowRight, SignOut } from "@phosphor-icons/react";
import { useAuth } from "../features/session/useAuth";
import { ApiError } from "../runtime/apiError";
import { HandleSchema } from "../runtime/contracts/session";
import type { Family } from "../data/models";
import { useFamilyLookup } from "../features/catalog/CatalogProvider";
import type { Generation } from "../lib/gallery";
import { useFavorites } from "../lib/favorites";
import { Orders, Sessions } from "../components/AccountSections";
import { useI18n, type TKey } from "../lib/i18n";
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

/**
 * Where the balance came from, one line per grant.
 *
 * The wallet carries `grants[]` — what each was, what it was worth, what is
 * left of it and whether it runs out — and nothing in the product had ever
 * drawn it. A single total cannot answer the question people actually arrive
 * with: four of the seven plans never expire and three do, so "۵۲۰ coins" may
 * be permanent, may be gone on Thursday, or may be some of each.
 */
function Balance({ wallet }: { wallet: Wallet }) {
  const { t, n, lang } = useI18n();
  const day = (at: number) => new Date(at).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { day: "numeric", month: "long" });
  // Spent grants are history, not balance; the soonest to run out leads.
  const live = wallet.grants
    .filter((grant) => grant.coinsRemaining > 0)
    .sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY));
  if (live.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-2.5 t-h2">{t("p_balance_from")}</div>
      <ul className="grid rounded-bezel border border-line bg-card px-3.5">
        {live.map((grant) => (
          <li key={grant.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-[13px]">{t(`p_grant_${grant.kind}` as TKey)}</span>
            <span className="shrink-0 t-caption text-ink3" style={{ color: grant.expiresAt == null ? "var(--vg-primary)" : undefined }}>
              {grant.expiresAt == null ? t("p_grant_never") : t("p_grant_until").replace("{d}", day(grant.expiresAt))}
            </span>
            <span className="shrink-0 tabular-nums text-[13px] font-semibold">
              {t("p_grant_left").replace("{a}", n(grant.coinsRemaining)).replace("{b}", n(grant.coinsGranted))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What they have made, by kind — and which model did most of it.
 *
 * The screen used to carry a bare «۱ ساخته‌شده» beside a row that said «۱
 * مورد», which is one fact printed twice and nothing learned either time.
 * Split by kind it answers something the gallery does not: what this account is
 * actually for.
 */
function Made({ gens }: { gens: Generation[] }) {
  const { t, n } = useI18n();
  const familyOf = useFamilyLookup();
  const done = gens.filter((g) => g.status === "done");
  if (done.length === 0) return <p className="mb-6 t-caption text-ink3">{t("p_nothing_yet")}</p>;

  const byKind = (["video", "image", "audio"] as const).map((kind) => ({
    kind,
    count: done.filter((g) => g.kind === kind).length,
  }));
  const tally = new Map<string, number>();
  for (const g of done) tally.set(g.familyId, (tally.get(g.familyId) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const topFamily = top ? familyOf(top[0]) : undefined;

  return (
    <div className="mb-6">
      <div className="mb-2.5 t-h2">{t("p_made_breakdown")}</div>
      <div className="grid grid-cols-3 gap-2.5">
        {byKind.map(({ kind, count }) => (
          <div key={kind} className="rounded-card border border-line bg-card py-3.5 text-center">
            <div className="font-display text-[20px] font-semibold tabular-nums">{n(count)}</div>
            <div className="t-caption text-ink3">{t(`p_kind_${kind}` as TKey)}</div>
          </div>
        ))}
      </div>
      {topFamily && (
        <p className="mt-2.5 t-caption text-ink3">
          {t("p_most_used")}:{" "}
          <span className="font-semibold text-ink" lang="en">
            {topFamily.name}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The account's own facts: the address it was made with, the number if there is
 * one, and how it can be signed into.
 *
 * Every row here is read-only, and that is a server limit rather than a
 * decision. `PATCH /api/v1/me` is `.strict()` over `handle` and `displayName`,
 * so nothing else can be written — and changing an email or a number is not a
 * form anyway, it is a verification round trip. The rows carry a note saying so
 * rather than an edit button that would fail.
 *
 * The phone row and the ways-in row appear only when the payload carries them.
 * Today it carries neither: `phone` is optional and unsent, and `methods` is
 * the single constant `["email"]` from every producer, which would print
 * "email" to somebody who has only ever used Google. Both light up on their own
 * once #142 lands; neither draws a placeholder in the meantime.
 */
function AccountFacts({ user }: { user: AccountUser }) {
  const { t } = useI18n();
  const ways = user.methods.length > 1 ? user.methods : [];

  return (
    <div className="mb-6">
      <div className="mb-2.5 t-h2">{t("p_account")}</div>
      <div className="grid rounded-bezel border border-line bg-card px-3.5">
        <Fact label={t("auth_email_label")} value={user.emailNormalized} />
        {user.phone && <Fact label={t("p_phone")} value={user.phone} />}
        {ways.length > 0 && (
          <div className="border-b border-line py-3 last:border-b-0">
            <div className="t-caption text-ink3">{t("p_signin_ways")}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ways.map((way) => (
                <span
                  key={way}
                  className="rounded-pill px-2.5 py-1 text-[11.5px] font-semibold"
                  style={{ background: "var(--vg-surface-overlay)" }}
                >
                  {t(`p_method_${way}` as TKey)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 t-caption text-ink3">{t("p_locked_hint")}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <div className="t-caption text-ink3">{label}</div>
      <div className="ltr mt-0.5 text-[13.5px] font-semibold" style={{ textAlign: "start" }}>
        {value}
      </div>
    </div>
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
  const { t, lang, setLang } = useI18n();
  const familyOf = useFamilyLookup();
  const user = account;
  /* The username, before the guest label. A password sign-up sets no display
     name, so a customer who had just registered — and had chosen a username
     two screens earlier — was greeted as «کاربرِ مهمان», a guest, on their own
     profile. Every account has had a handle since it became NOT NULL, so the
     guest wording is now reachable only by an actual visitor, which is the
     only thing it ever meant. */
  const name = user?.displayName || user?.handle || t("p_guest");
  const { favs } = useFavorites();
  const favFamilies = favs.map(familyOf).filter((f): f is Family => Boolean(f));

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

          {/* What was here: a three-up strip reading «made», «favourites» and
              the balance. Every one of those numbers is printed somewhere else
              on the same screen — the balance twice over, once in the chrome
              above it. Replaced by the two things nothing else says: what the
              balance is made of, and what the account has actually made. */}
          <AccountFacts user={user} />

          <Balance wallet={wallet} />

          <Made gens={gens} />

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
                        <ModelMark familyId={f.id} vendor={f.vendor} size={15} />
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
            {/* No count on either. The gallery's was the same figure the strip
                above used to print, and the favourites' was the length of the
                row of favourites sitting directly beside it. The links are
                worth keeping; the numbers were saying it twice. */}
            <Row icon={<ImagesSquare size={18} weight="fill" />} label={t("p_gallery")} onClick={onGallery} />
          </div>

          <div className="divide-y divide-line rounded-bezel border border-line bg-card">
            <Row
              icon={<Globe size={18} />}
              label={t("p_lang")}
              value={lang === "fa" ? "فارسی" : "English"}
              onClick={() => setLang(lang === "fa" ? "en" : "fa")}
            />
            <Row icon={<SignOut size={18} />} label={t("p_logout")} onClick={onSignOut} />
          </div>

          {/* Each of these asks for a route the server has not built, and each
              renders nothing when its query fails — so this column is shorter
              rather than broken on a deployment without them. See #142, #143.

              `DeleteAccount` is deliberately not among them. It has no query to
              fail: it is a button that is always visible, and pressing it would
              take somebody through typing their own handle to confirm and then
              answer «چیزی درست پیش نرفت». A read that quietly renders nothing is
              honest; an action that cannot work is not. One line restores it the
              day `DELETE /me` answers:

                  <DeleteAccount handle={user.handle} /> */}
          <div className="mt-6">
            <Sessions />
            <Orders />
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
  /* Refused on blur rather than on every keystroke. Validating as somebody
     types tells them their half-finished username is wrong, which it is, and
     which they already know. */
  const [touched, setTouched] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName ?? "");

  // The same rule the server applies, so an impossible name is refused before
  // the round trip rather than after it.
  const handleOk = HandleSchema.safeParse(handle).success;
  const handleBad = touched && !handleOk && handle.length > 0;
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
          {/* Only when it says something the line above did not. */}
          {name === user.handle ? null : <div className="ltr t-caption text-accent">@{user.handle}</div>}
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
        {/* No `aria-label`: the label wraps the input, and an aria-label would
            override that visible text for a screen reader — two names for one
            field, free to drift apart. `aria-describedby` instead, so the error
            below is read as this field's error rather than as loose text. */}
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={handleBad ? "handle-error" : undefined}
          aria-invalid={handleBad || undefined}
          autoComplete="username"
          minLength={3}
          maxLength={24}
          dir="ltr"
          className="h-10 rounded-xl border border-line bg-transparent px-3 t-body"
          style={handleBad ? { borderColor: "var(--vg-danger)" } : undefined}
        />
      </label>
      <label className="grid gap-1 t-caption text-ink3">
        {t("p_display_name")}
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={80}
          className="h-10 rounded-xl border border-line bg-transparent px-3 t-body"
        />
      </label>

      {handleBad && (
        <p id="handle-error" role="alert" className="t-caption" style={{ color: "var(--vg-danger)" }}>
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
