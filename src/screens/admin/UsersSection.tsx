import { useState, type FormEvent } from "react";
import type { AdminApi, AdminBan } from "../../features/admin/adminApi";
import { useUser, useUserActions, useUsers } from "../../features/admin/useAdmin";
import { Cell, Muted, Row, Stat, Table, num, usd, when } from "./primitives";

/**
 * Every customer, and what one of them has done.
 *
 * The list carries email addresses beside spending, which is why the route
 * behind it needs `users.read` on top of `analytics.read` — somebody can be
 * given the money dashboard without being given the mailing list.
 *
 * Everyone is here, including people who signed up and never generated.
 * "This person says they paid and I cannot find them" is precisely the case
 * this screen exists for, and a list filtered to active accounts answers it
 * with silence.
 */

const PAGE = 25;

const SORTS: { id: "spent" | "purchased" | "balance" | "created"; label: string }[] = [
  { id: "spent", label: "بیشترین خرج" },
  { id: "purchased", label: "بیشترین خرید" },
  { id: "balance", label: "بیشترین موجودی" },
  { id: "created", label: "تازه‌ترین" },
];

export function UsersSection({ api, canWrite, canGrant }: { api: AdminApi; canWrite: boolean; canGrant: boolean }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("spent");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const users = useUsers(api, { search: search.trim() || undefined, sort, limit: PAGE, offset: page * PAGE }, true);

  if (openId) return <UserDetail api={api} userId={openId} canWrite={canWrite} canGrant={canGrant} onClose={() => setOpenId(null)} />;

  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            // A new search is a new list; keeping the page number would land on
            // page 4 of a two-page result and look like an empty database.
            setPage(0);
          }}
          placeholder="جست‌وجو بر اساس ایمیل، نام کاربری یا نام"
          aria-label="جست‌وجوی کاربر"
          className="h-8 min-w-[240px] flex-1 rounded-lg px-2.5 text-[12.5px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as (typeof SORTS)[number]["id"]);
            setPage(0);
          }}
          aria-label="ترتیب"
          className="h-8 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        >
          {SORTS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      {users.error ? <Muted>فهرست کاربران خوانده نشد.</Muted> : null}
      {users.isPending ? <Muted>در حال خواندن…</Muted> : null}

      {users.data ? (
        <>
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
            {num(total)} کاربر
          </p>
          <Table head={["کاربر", "موجودی", "خریده", "خرج کرده", "جاب", "هزینه‌ی ما", "آخرین ساخت"]}>
            {users.data.users.map((user) => (
              <Row key={user.id}>
                <Cell>
                  <button onClick={() => setOpenId(user.id)} className="text-start underline-offset-2 hover:underline">
                    <span dir="ltr">{user.email ?? user.handle ?? user.id.slice(0, 8)}</span>
                  </button>
                  {user.activeBans > 0 ? (
                    <span className="ms-1.5 text-[10.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
                      مسدود
                    </span>
                  ) : null}
                </Cell>
                <Cell>{num(user.coinsBalance)}</Cell>
                <Cell dim>{num(user.coinsPurchased)}</Cell>
                <Cell>{num(user.coinsSpent)}</Cell>
                <Cell dim>{num(user.jobs)}</Cell>
                <Cell dim>
                  <span dir="ltr">{usd(user.providerCostUsd)}</span>
                </Cell>
                <Cell dim>{when(user.lastJobAt)}</Cell>
              </Row>
            ))}
          </Table>

          {pages > 1 ? (
            <div className="mt-3 flex items-center gap-2 text-[12px]">
              <button
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                disabled={page === 0}
                className="h-7 rounded-lg px-2.5 disabled:opacity-40"
                style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
              >
                قبلی
              </button>
              <span style={{ color: "var(--vg-text-faint)" }} dir="ltr">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
                disabled={page >= pages - 1}
                className="h-7 rounded-lg px-2.5 disabled:opacity-40"
                style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
              >
                بعدی
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One customer, with the three things support can actually do about them.
 *
 * Each action is audited before it answers and the ledger is append-only at the
 * database, so an adjustment made here cannot be tidied away afterwards by
 * whoever made it. That is the reason the note is required rather than
 * optional: an unexplained entry in a permanent record is a permanent mystery.
 */
function UserDetail({
  api,
  userId,
  canWrite,
  canGrant,
  onClose,
}: {
  api: AdminApi;
  userId: string;
  canWrite: boolean;
  canGrant: boolean;
  onClose: () => void;
}) {
  const detail = useUser(api, userId);
  const actions = useUserActions(api, userId);

  if (detail.isPending) return <Muted>در حال خواندن…</Muted>;
  if (detail.error || !detail.data) return <Muted>این کاربر خوانده نشد.</Muted>;

  const { user, bans } = detail.data;

  return (
    <div>
      <button onClick={onClose} className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        ← برگشت به فهرست
      </button>
      <h3 className="mt-2 text-[15px] font-bold" style={{ color: "var(--vg-text)" }} dir="ltr">
        {user.email ?? user.handle ?? user.id}
      </h3>
      <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
        عضو از {when(user.createdAt)}
        {user.displayName ? ` · ${user.displayName}` : ""}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="موجودی" value={num(user.coinsBalance)} {...(user.coinsHeld > 0 ? { hint: `${num(user.coinsHeld)} رزرو‌شده` } : {})} />
        <Stat label="خریده" value={num(user.coinsPurchased)} />
        <Stat label="خرج کرده" value={num(user.coinsSpent)} />
        <Stat label="هزینه‌ی ما" value={usd(user.providerCostUsd)} hint={`${num(user.jobs)} جاب`} />
      </div>

      {bans.length > 0 ? (
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-danger, #ff6c52)" }}>
          <p className="text-[12.5px] font-bold" style={{ color: "var(--vg-danger, #ff6c52)" }}>
            مسدود
          </p>
          {bans.map((ban) => (
            <div key={ban.id} className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <span style={{ color: "var(--vg-text)" }}>{SCOPE_LABEL[ban.scope]}</span>
              <span style={{ color: "var(--vg-text-faint)" }}>{ban.reason ?? "بدون دلیل ثبت‌شده"}</span>
              <span style={{ color: "var(--vg-text-faint)" }}>{ban.expiresAt === null ? "دائمی" : `تا ${when(ban.expiresAt)}`}</span>
              {canWrite ? (
                <button
                  onClick={() => actions.liftBan.mutate(ban.id)}
                  disabled={actions.liftBan.isPending}
                  className="ms-auto h-7 rounded-lg px-2.5 text-[11.5px]"
                  style={{
                    background: "var(--vg-bg, #0a0a0b)",
                    color: "var(--vg-text-muted)",
                    border: "1px solid var(--vg-border-subtle)",
                  }}
                >
                  برداشتن
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {canGrant ? <AdjustCredits actions={actions} /> : null}
        {canWrite ? <BanControls actions={actions} hasBan={bans.length > 0} /> : null}
      </div>

      <h4 className="mt-6 text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
        آخرین جاب‌ها
      </h4>
      {user.recentJobs.length === 0 ? (
        <Muted>این کاربر هنوز چیزی نساخته است.</Muted>
      ) : (
        <Table head={["مدل", "وضعیت", "سکه", "هزینه‌ی ما", "کی"]}>
          {user.recentJobs.map((job) => (
            <Row key={job.id}>
              <Cell>
                <span dir="ltr">{job.modelKey ?? "—"}</span>
              </Cell>
              <Cell>
                <span style={{ color: job.status === "failed" ? "var(--vg-danger, #ff6c52)" : "var(--vg-text-muted)" }} dir="ltr">
                  {job.status}
                </span>
                {job.errorCode ? (
                  <span className="ms-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
                    {job.errorCode}
                  </span>
                ) : null}
              </Cell>
              <Cell>{num(job.coinsCharged)}</Cell>
              <Cell dim>
                <span dir="ltr">{job.providerCostUsd === null ? "—" : usd(job.providerCostUsd)}</span>
              </Cell>
              <Cell dim>{when(job.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      )}

      <h4 className="mt-6 text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
        دفتر سکه
      </h4>
      {user.recentLedger.length === 0 ? (
        <Muted>هیچ حرکتی ثبت نشده است.</Muted>
      ) : (
        <Table head={["نوع", "مقدار", "موجودی پس از آن", "یادداشت", "کی"]}>
          {user.recentLedger.map((entry) => (
            <Row key={entry.id}>
              <Cell dim>
                <span dir="ltr">{entry.entryType}</span>
              </Cell>
              <Cell>
                <span style={{ color: entry.coins < 0 ? "var(--vg-text-muted)" : "var(--vg-primary-soft)" }} dir="ltr">
                  {entry.coins > 0 ? `+${num(entry.coins)}` : num(entry.coins)}
                </span>
              </Cell>
              <Cell dim>{num(entry.balanceAfterCoins)}</Cell>
              <Cell dim>{entry.note ?? "—"}</Cell>
              <Cell dim>{when(entry.createdAt)}</Cell>
            </Row>
          ))}
        </Table>
      )}

      {canWrite ? (
        <div className="mt-6">
          <button
            onClick={() => actions.revokeSessions.mutate()}
            disabled={actions.revokeSessions.isPending}
            className="h-8 rounded-lg px-3 text-[12px]"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
          >
            {actions.revokeSessions.isPending ? "…" : "خروج از همه‌ی دستگاه‌ها"}
          </button>
          {actions.revokeSessions.isSuccess ? (
            <span className="ms-2 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
              {num(actions.revokeSessions.data ?? 0)} نشست بسته شد.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SCOPE_LABEL: Record<AdminBan["scope"], string> = {
  platform: "کل سرویس",
  generation: "ساخت تازه",
  explore: "انتشار در جامعه",
  comments: "نظر دادن",
};

function AdjustCredits({ actions }: { actions: ReturnType<typeof useUserActions> }) {
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(coins);
    if (!Number.isInteger(value) || value === 0 || note.trim().length < 3) return;
    actions.adjustCredits.mutate(
      { coins: value, note: note.trim() },
      {
        onSuccess: () => {
          setCoins("");
          setNote("");
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl p-3"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
        اصلاح موجودی
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={coins}
          onChange={(event) => setCoins(event.target.value)}
          type="number"
          placeholder="۵۰ یا ۵۰-"
          aria-label="تعداد سکه"
          dir="ltr"
          className="h-8 w-24 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="چرا — این یادداشت پاک‌شدنی نیست"
          aria-label="دلیل اصلاح"
          className="h-8 min-w-[180px] flex-1 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <button
          type="submit"
          disabled={actions.adjustCredits.isPending}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
        >
          {actions.adjustCredits.isPending ? "…" : "ثبت"}
        </button>
      </div>
      {actions.adjustCredits.error ? (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          ثبت نشد — شاید موجودی برای کسر کافی نیست.
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
        عدد منفی کسر می‌کند. دفتر سکه فقط اضافه‌شدنی است؛ این ردیف بعداً پاک نمی‌شود.
      </p>
    </form>
  );
}

function BanControls({ actions, hasBan }: { actions: ReturnType<typeof useUserActions>; hasBan: boolean }) {
  const [scope, setScope] = useState<AdminBan["scope"]>("generation");
  const [reason, setReason] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        actions.ban.mutate({ scope, ...(reason.trim() ? { reason: reason.trim() } : {}) }, { onSuccess: () => setReason("") });
      }}
      className="rounded-xl p-3"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
        مسدود کردن
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as AdminBan["scope"])}
          aria-label="دامنه‌ی مسدودی"
          className="h-8 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        >
          {(Object.keys(SCOPE_LABEL) as AdminBan["scope"][]).map((value) => (
            <option key={value} value={value}>
              {SCOPE_LABEL[value]}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="دلیل"
          aria-label="دلیل مسدودی"
          className="h-8 min-w-[160px] flex-1 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <button
          type="submit"
          disabled={actions.ban.isPending}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
          style={{ background: "var(--vg-surface)", color: "var(--vg-danger, #ff6c52)", border: "1px solid var(--vg-danger, #ff6c52)" }}
        >
          {actions.ban.isPending ? "…" : hasBan ? "مسدودی دیگر" : "مسدود کن"}
        </button>
      </div>
      {/* Said plainly because the scopes are not obvious and the wrong one is a
          quiet mistake: a generation ban still lets the person sign in and use
          what they already paid for, which is the behaviour we chose. */}
      <p className="mt-1.5 text-[11px] leading-4" style={{ color: "var(--vg-text-faint)" }}>
        «ساخت تازه» ورود را نمی‌بندد؛ کاربر همچنان به کارهایی که پولش را داده دسترسی دارد. «انتشار در جامعه» فعلاً چیزی را رد نمی‌کند، چون
        هنوز مسیری برای انتشار وجود ندارد.
      </p>
    </form>
  );
}
