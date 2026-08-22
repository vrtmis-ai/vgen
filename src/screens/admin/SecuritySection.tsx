import type { AdminApi } from "../../features/admin/adminApi";
import { useAdminSessionRevoke, useAdminSessions } from "../../features/admin/useAdmin";
import { Cell, Muted, Row, Table, when } from "./primitives";

/**
 * Who is signed in to this panel right now.
 *
 * `admin_sessions` has recorded the IP, the user agent, when the second factor
 * was passed and when the session was last used since migration 0012 — and
 * nothing has ever read a byte of it. The question it exists to answer is *is
 * there a session open that I do not recognise?*, which nobody could ask until
 * this screen.
 *
 * **No token appears here and none could.** The table stores a hash of the
 * token and the query never selects it. What identifies a session to a person
 * is where it came from and when it was last used, not its secret.
 *
 * Your own session is marked rather than hidden. It is the one row you can
 * definitely identify, which is what makes the others legible.
 */
export function SecuritySection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const sessions = useAdminSessions(api, true);
  const revoke = useAdminSessionRevoke(api);

  if (sessions.isPending) return <Muted>در حال خواندن نشست‌ها…</Muted>;
  if (sessions.error) return <Muted>نشست‌ها خوانده نشدند.</Muted>;

  const others = sessions.data.filter((session) => !session.current).length;

  return (
    <div>
      <p className="mb-3 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
        هر نشست کارکنان که همین حالا باز است. نشست‌ها حداکثر ۱۲ ساعت زنده‌اند و اگر ۹۰ دقیقه بی‌استفاده بمانند زودتر از آن می‌میرند. هیچ
        توکنی اینجا نیست و نمی‌تواند باشد — جدول فقط هش آن را نگه می‌دارد.
      </p>

      <Table head={["کارمند", "آدرس", "مرورگر", "دومرحله‌ای", "آخرین استفاده", "انقضا", ""]}>
        {sessions.data.map((session) => (
          <Row key={session.id}>
            <Cell>
              <span dir="ltr">{session.email ?? session.userId.slice(0, 8)}</span>
              {session.current ? (
                <span className="ms-1.5 text-[10.5px]" style={{ color: "var(--vg-primary-soft)" }}>
                  همین نشست
                </span>
              ) : null}
            </Cell>
            <Cell dim>
              <span dir="ltr">{session.ip ?? "—"}</span>
            </Cell>
            <Cell dim>
              {/* Truncated: a full user agent is a paragraph, and the only part
                  anybody reads is which browser and platform it claims to be. */}
              <span dir="ltr" className="block max-w-[220px] truncate text-[11px]" title={session.userAgent ?? undefined}>
                {session.userAgent ?? "—"}
              </span>
            </Cell>
            <Cell>
              <span style={{ color: session.mfaVerified ? "var(--vg-text-faint)" : "var(--vg-danger, #ff6c52)" }}>
                {/* A session without it is not half-signed-in, it is a password
                    step that never finished and authorises nothing. */}
                {session.mfaVerified ? "بله" : "نه — هنوز چیزی اجازه نمی‌دهد"}
              </span>
            </Cell>
            <Cell dim>{when(session.lastUsedAt)}</Cell>
            <Cell dim>
              <span dir="ltr">{new Date(session.expiresAt).toISOString().slice(11, 16)}</span>
            </Cell>
            <Cell>
              {canWrite ? (
                <button
                  onClick={() => revoke.one.mutate(session.id)}
                  disabled={revoke.one.isPending}
                  className="h-7 rounded-lg px-2.5 text-[11.5px]"
                  style={{
                    background: "var(--vg-surface)",
                    color: session.current ? "var(--vg-text-muted)" : "var(--vg-danger, #ff6c52)",
                    border: "1px solid var(--vg-border-subtle)",
                  }}
                >
                  {session.current ? "خروج" : "بستن"}
                </button>
              ) : null}
            </Cell>
          </Row>
        ))}
      </Table>

      {canWrite && others > 0 ? (
        <div className="mt-4">
          <button
            onClick={() => revoke.others.mutate()}
            disabled={revoke.others.isPending}
            className="h-8 rounded-lg px-3 text-[12px] font-semibold"
            style={{ background: "var(--vg-surface)", color: "var(--vg-danger, #ff6c52)", border: "1px solid var(--vg-danger, #ff6c52)" }}
          >
            {revoke.others.isPending ? "…" : `بستن ${others} نشست دیگر`}
          </button>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            همه به‌جز همین یکی. اگر فکر می‌کنی کسی به حسابی دسترسی پیدا کرده، این دکمه است.
          </p>
        </div>
      ) : null}

      {!canWrite ? <Muted>برای بستن نشست‌ها اجازه‌ی security.write لازم است.</Muted> : null}
      {revoke.one.error || revoke.others.error ? <Muted>بسته نشد.</Muted> : null}
    </div>
  );
}
