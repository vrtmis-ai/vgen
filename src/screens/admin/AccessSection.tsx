import { useState, type FormEvent } from "react";
import type { AdminApi, AdminInvite } from "../../features/admin/adminApi";
import { ApiError } from "../../runtime/apiError";
import { useEarlyAccess, useInviteMutations, useInvites, usePromoMutations, usePromos, useSiteBanner } from "../../features/admin/useAdmin";
import { Cell, Muted, Table } from "./primitives";

/**
 * Who gets in, and what they pay.
 *
 * The one behaviour worth knowing before using this page: **deleting a code
 * that somebody has already used revokes it instead.** The server decides
 * which, and answers with the outcome, because deleting a redeemed code would
 * erase the campaign's own result and the trail for tracing an abusive
 * inviter. The button therefore says "remove", not "delete", and the row
 * reports which happened.
 */
export function AccessSection({ api, canWrite, canFlags }: { api: AdminApi; canWrite: boolean; canFlags: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <EarlyAccess api={api} canWrite={canFlags} />
      <SiteBanner api={api} canWrite={canFlags} />
      <Invites api={api} canWrite={canWrite} />
      <Promos api={api} canWrite={canWrite} />
    </div>
  );
}

/**
 * The announcement strip across the top of the site.
 *
 * `GET`/`PATCH /admin/site-banner` have been live under `flags.write` since the
 * strip shipped, and nothing called them: turning a finished campaign's strip
 * off meant curl. Absent or deleted reads as on, which is why this can only
 * ever show a real answer from the server.
 */
function SiteBanner({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const { query, set } = useSiteBanner(api, true);

  return (
    <section>
      <Heading>نوار اعلان</Heading>
      {query.isPending ? (
        <Muted>…</Muted>
      ) : query.error ? (
        <Muted>خوانده نشد.</Muted>
      ) : (
        <label className="mt-2 flex items-center gap-2 text-[13px]" style={{ color: "var(--vg-text)" }}>
          <input
            type="checkbox"
            checked={query.data}
            disabled={!canWrite || set.isPending}
            onChange={(event) => set.mutate(event.target.checked)}
          />
          نوار اعلان بالای سایت نشان داده شود
        </label>
      )}
      <Muted>متن نوار از کمپین فعال می‌آید؛ این تیک فقط نشان‌دادن یا ندادنش را تعیین می‌کند و در audit_log ثبت می‌شود.</Muted>
    </section>
  );
}

function EarlyAccess({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const { query, set } = useEarlyAccess(api, true);

  return (
    <section>
      <Heading>دسترسی زودهنگام</Heading>
      {query.isPending ? (
        <Muted>…</Muted>
      ) : query.error ? (
        <Muted>خوانده نشد.</Muted>
      ) : (
        <label className="mt-2 flex items-center gap-2 text-[13px]" style={{ color: "var(--vg-text)" }}>
          <input
            type="checkbox"
            checked={query.data}
            disabled={!canWrite || set.isPending}
            onChange={(event) => set.mutate(event.target.checked)}
          />
          فقط با کد دعوت
        </label>
      )}
      <Muted>
        برداشتن این تیک، محصول را برای همه باز می‌کند. یکی از پرپیامدترین کارهایی است که از این صفحه برمی‌آید، و مثل بقیه در audit_log ثبت
        می‌شود.
      </Muted>
    </section>
  );
}

/** The last moment of a calendar day, in the browser's own zone. A code "valid until the 20th" works on the 20th. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59`);
/** `yyyy-mm-dd` for a date input, in local time. */
const dayOf = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const faDate = (ms: number) => new Date(ms).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });

/** Why a code does or does not admit anyone, in the order the server checks. */
function statusOf(invite: AdminInvite, now: number): string {
  if (invite.revokedAt !== null) return "باطل";
  if (invite.startsAt > now) return "هنوز شروع نشده";
  if (invite.expiresAt !== null && invite.expiresAt <= now) return "منقضی";
  if (invite.maxRedemptions !== null && invite.redemptionCount >= invite.maxRedemptions) return "ظرفیت پر";
  return "فعال";
}

function Invites({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const invites = useInvites(api, true);
  const { create, update, remove } = useInviteMutations(api);
  const [code, setCode] = useState("");
  const [coins, setCoins] = useState("");
  const [count, setCount] = useState("1");
  const [maxUses, setMaxUses] = useState("1");
  const [expiry, setExpiry] = useState(() => dayOf(Date.now() + 30 * 86_400_000));
  const [editing, setEditing] = useState<{ id: string; maxUses: string; expiry: string } | null>(null);
  const now = Date.now();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const batch = Number(count) || 1;
    create.mutate({
      // A custom code cannot be batched — the server refuses it, and sending
      // both would be asking for five codes that share one string.
      ...(code.trim() && batch === 1 ? { code: code.trim() } : {}),
      ...(Number(coins) > 0 ? { grantCoins: Number(coins) } : {}),
      ...(batch > 1 ? { count: batch } : {}),
      maxRedemptions: Number(maxUses),
      expiresAt: endOfDay(expiry).toISOString(),
    });
    setCode("");
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    update.mutate(
      { id: editing.id, input: { maxRedemptions: Number(editing.maxUses), expiresAt: endOfDay(editing.expiry).toISOString() } },
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <section>
      <Heading>کدهای دعوت</Heading>

      {canWrite ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
          <Labelled label="کد دلخواه (اختیاری)">
            <Field value={code} onChange={setCode} placeholder="کد دلخواه (اختیاری)" ltr />
          </Labelled>
          <Labelled label="چند نفر می‌توانند استفاده کنند">
            <Field value={maxUses} onChange={setMaxUses} placeholder="ظرفیت" ltr width="w-24" type="number" min={1} required />
          </Labelled>
          <Labelled label={expiry ? `تاریخ انقضا — ${faDate(endOfDay(expiry).getTime())}` : "تاریخ انقضا"}>
            <Field value={expiry} onChange={setExpiry} placeholder="تاریخ انقضا" ltr width="w-40" type="date" min={dayOf(now)} required />
          </Labelled>
          <Labelled label="سکه‌ی هدیه">
            <Field value={coins} onChange={setCoins} placeholder="سکه‌ی هدیه" ltr width="w-24" />
          </Labelled>
          <Labelled label="تعداد کد">
            <Field value={count} onChange={setCount} placeholder="تعداد" ltr width="w-20" />
          </Labelled>
          <Action busy={create.isPending}>ساخت</Action>
          {create.error ? <Problem /> : null}
        </form>
      ) : null}

      {invites.isPending ? (
        <Muted>…</Muted>
      ) : invites.error ? (
        <Muted>کدها خوانده نشدند.</Muted>
      ) : (
        <div className="mt-3">
          <Table head={["کد", "وضعیت", "استفاده‌شده / ظرفیت", "انقضا", "هدیه", "سکه‌ی خرج‌شده", ""]}>
            {invites.data.map((invite) =>
              editing?.id === invite.id ? (
                <tr key={invite.id} className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
                  <Cell>
                    <span dir="ltr">{invite.code}</span>
                  </Cell>
                  <Cell dim>{statusOf(invite, now)}</Cell>
                  <Cell>
                    <span className="inline-flex items-center gap-1">
                      <span dir="ltr">{invite.redemptionCount} /</span>
                      <Field
                        value={editing.maxUses}
                        onChange={(next) => setEditing({ ...editing, maxUses: next })}
                        placeholder="ظرفیت"
                        ltr
                        width="w-20"
                        type="number"
                        min={Math.max(invite.redemptionCount, 1)}
                        form={`invite-${invite.id}`}
                        required
                      />
                    </span>
                  </Cell>
                  <Cell>
                    <Field
                      value={editing.expiry}
                      onChange={(next) => setEditing({ ...editing, expiry: next })}
                      placeholder="تاریخ انقضا"
                      ltr
                      width="w-40"
                      type="date"
                      form={`invite-${invite.id}`}
                      required
                    />
                  </Cell>
                  <Cell dim>{invite.grantCoins}</Cell>
                  <Cell dim>{invite.coinsSpent}</Cell>
                  <Cell>
                    <form id={`invite-${invite.id}`} onSubmit={save} className="inline-flex items-center gap-2">
                      <Action busy={update.isPending}>ذخیره</Action>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-[12px]"
                        style={{ color: "var(--vg-text-faint)" }}
                      >
                        انصراف
                      </button>
                    </form>
                  </Cell>
                </tr>
              ) : (
                <tr key={invite.id} className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
                  <Cell>
                    <span dir="ltr">{invite.code}</span>
                  </Cell>
                  <Cell dim>{statusOf(invite, now)}</Cell>
                  <Cell dim>
                    <span dir="ltr">
                      {invite.redemptionCount} / {invite.maxRedemptions ?? "∞"}
                    </span>
                  </Cell>
                  <Cell dim>{invite.expiresAt === null ? "بدون انقضا" : faDate(invite.expiresAt)}</Cell>
                  <Cell dim>{invite.grantCoins}</Cell>
                  <Cell dim>{invite.coinsSpent}</Cell>
                  <Cell>
                    {canWrite ? (
                      <span className="inline-flex gap-3">
                        {invite.revokedAt === null ? (
                          <button
                            onClick={() => {
                              update.reset();
                              setEditing({
                                id: invite.id,
                                maxUses: String(invite.maxRedemptions ?? Math.max(invite.redemptionCount, 1)),
                                expiry: dayOf(invite.expiresAt ?? now + 30 * 86_400_000),
                              });
                            }}
                            className="text-[12px]"
                            style={{ color: "var(--vg-text-secondary)" }}
                          >
                            ویرایش
                          </button>
                        ) : null}
                        <button onClick={() => remove.mutate(invite.id)} className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
                          برداشتن
                        </button>
                      </span>
                    ) : null}
                  </Cell>
                </tr>
              ),
            )}
          </Table>
          {update.error ? (
            <Muted>
              {update.error instanceof ApiError && update.error.code === "limit_below_used"
                ? "ظرفیت نمی‌تواند کمتر از تعداد کسانی باشد که تا الان از این کد استفاده کرده‌اند."
                : "ذخیره نشد."}
            </Muted>
          ) : null}
          {remove.data ? <Muted>{remove.data === "deleted" ? "حذف شد." : "استفاده شده بود، پس باطل شد."}</Muted> : null}
        </div>
      )}
    </section>
  );
}

function Promos({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const promos = usePromos(api, true);
  const { create, remove } = usePromoMutations(api);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"credits" | "percent_off" | "amount_off" | "free_term">("percent_off");
  const [amount, setAmount] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    create.mutate({
      kind,
      ...(code.trim() ? { code: code.trim() } : {}),
      // The server reads exactly one of these, chosen by `kind`. Sending the
      // wrong one is how a "20% off" becomes 20 free coins.
      ...(kind === "percent_off" && value > 0 ? { percentOff: value } : {}),
      ...(kind === "amount_off" && value > 0 ? { amountOff: value } : {}),
      ...(kind === "credits" && value > 0 ? { coins: value } : {}),
    });
    setCode("");
  };

  return (
    <section>
      <Heading>کدهای تخفیف</Heading>

      {canWrite ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <Field value={code} onChange={setCode} placeholder="کد (اختیاری)" ltr />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
            aria-label="نوع تخفیف"
            className="h-8 rounded-lg px-2 text-[12px]"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <option value="percent_off">درصدی</option>
            <option value="amount_off">مبلغ ثابت (تومان)</option>
            <option value="credits">سکه‌ی رایگان</option>
            <option value="free_term">دوره‌ی رایگان</option>
          </select>
          {kind === "free_term" ? null : <Field value={amount} onChange={setAmount} placeholder="مقدار" ltr width="w-28" />}
          <Action busy={create.isPending}>ساخت</Action>
          {create.error ? <Problem /> : null}
        </form>
      ) : null}

      {promos.isPending ? (
        <Muted>…</Muted>
      ) : promos.error ? (
        <Muted>کدها خوانده نشدند.</Muted>
      ) : (
        <div className="mt-3">
          <Table head={["کد", "نوع", "مقدار", "استفاده", "فقط خرید اول", ""]}>
            {promos.data.map((promo) => (
              <tr key={promo.id} className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
                <Cell>
                  <span dir="ltr">{promo.code}</span>
                  {!promo.isUsable ? (
                    <span className="ms-2 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                      {promo.revokedAt === null ? "تمام‌شده" : "باطل"}
                    </span>
                  ) : null}
                </Cell>
                <Cell dim>{promo.kind}</Cell>
                <Cell dim>{promo.percentOff ?? promo.amountOff ?? promo.coins ?? "—"}</Cell>
                <Cell dim>
                  {promo.redemptionCount}
                  {promo.maxRedemptions === null ? "" : ` / ${promo.maxRedemptions}`}
                </Cell>
                <Cell dim>{promo.firstPurchaseOnly ? "بله" : "نه"}</Cell>
                <Cell>
                  {canWrite ? (
                    <button onClick={() => remove.mutate(promo.id)} className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
                      برداشتن
                    </button>
                  ) : null}
                </Cell>
              </tr>
            ))}
          </Table>
          {remove.data ? <Muted>{remove.data === "deleted" ? "حذف شد." : "استفاده شده بود، پس باطل شد."}</Muted> : null}
        </div>
      )}
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
      {children}
    </h3>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  ltr = false,
  width = "w-40",
  type = "text",
  min,
  required = false,
  form,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ltr?: boolean;
  width?: string;
  type?: "text" | "number" | "date";
  min?: number | string | undefined;
  required?: boolean;
  /** For a field that sits in a table row, outside the form it submits with. */
  form?: string | undefined;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      type={type}
      {...(min === undefined ? {} : { min })}
      {...(form === undefined ? {} : { form })}
      required={required}
      {...(ltr ? { dir: "ltr" as const } : {})}
      className={`h-8 rounded-lg px-2 text-[12px] ${width}`}
      style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
    />
  );
}

/** A visible label over a field. A placeholder alone vanishes the moment a date is picked. */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
      {label}
      {children}
    </label>
  );
}

function Action({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
      style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
    >
      {busy ? "…" : children}
    </button>
  );
}

function Problem() {
  return (
    <span role="alert" className="text-[12px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
      ساخته نشد.
    </span>
  );
}
