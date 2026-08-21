import { useState, type FormEvent } from "react";
import type { AdminApi } from "../../features/admin/adminApi";
import { useEarlyAccess, useInviteMutations, useInvites, usePromoMutations, usePromos } from "../../features/admin/useAdmin";
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
      <Invites api={api} canWrite={canWrite} />
      <Promos api={api} canWrite={canWrite} />
    </div>
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

function Invites({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const invites = useInvites(api, true);
  const { create, remove } = useInviteMutations(api);
  const [code, setCode] = useState("");
  const [coins, setCoins] = useState("");
  const [count, setCount] = useState("1");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const batch = Number(count) || 1;
    create.mutate({
      // A custom code cannot be batched — the server refuses it, and sending
      // both would be asking for five codes that share one string.
      ...(code.trim() && batch === 1 ? { code: code.trim() } : {}),
      ...(Number(coins) > 0 ? { grantCoins: Number(coins) } : {}),
      ...(batch > 1 ? { count: batch } : {}),
    });
    setCode("");
  };

  return (
    <section>
      <Heading>کدهای دعوت</Heading>

      {canWrite ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <Field value={code} onChange={setCode} placeholder="کد دلخواه (اختیاری)" ltr />
          <Field value={coins} onChange={setCoins} placeholder="سکه‌ی هدیه" ltr width="w-28" />
          <Field value={count} onChange={setCount} placeholder="تعداد" ltr width="w-20" />
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
          <Table head={["کد", "هدیه", "استفاده", "کاربران", "سکه‌ی خرج‌شده", ""]}>
            {invites.data.map((invite) => (
              <tr key={invite.id} className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
                <Cell>
                  <span dir="ltr">{invite.code}</span>
                  {!invite.isUsable ? (
                    <span className="ms-2 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                      {invite.revokedAt === null ? "تمام‌شده" : "باطل"}
                    </span>
                  ) : null}
                </Cell>
                <Cell dim>{invite.grantCoins}</Cell>
                <Cell dim>
                  {invite.redemptionCount}
                  {invite.maxRedemptions === null ? "" : ` / ${invite.maxRedemptions}`}
                </Cell>
                <Cell dim>{invite.usersJoined}</Cell>
                <Cell dim>{invite.coinsSpent}</Cell>
                <Cell>
                  {canWrite ? (
                    <button onClick={() => remove.mutate(invite.id)} className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
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
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ltr?: boolean;
  width?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      {...(ltr ? { dir: "ltr" as const } : {})}
      className={`h-8 rounded-lg px-2 text-[12px] ${width}`}
      style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
    />
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
