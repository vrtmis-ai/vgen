import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminApi } from "../../features/admin/adminApi";
import { Cell, Muted, Row, Table, num, when } from "./primitives";

/**
 * The three things that used to need an SSH session.
 *
 * **Failures.** The dashboard has counted them since it shipped and listed
 * none, so "my video failed" was answerable only in psql — and the first
 * question after it, "was I charged?", needs the row rather than a count.
 *
 * **The rate.** Checkout prices in Toman from `fx_rates`, refreshed hourly by
 * the worker behind a plausibility band. When that band or a dead source
 * leaves the rate stale, the fix was `docker compose exec worker … --force`.
 *
 * **The audit log.** Written by every mutating admin route since the panel
 * shipped and read by nothing, while three places in this panel promise staff
 * that their changes are recorded.
 */
export function OpsSection({ api, canWriteFx }: { api: AdminApi; canWriteFx: boolean }) {
  const queryClient = useQueryClient();
  const failures = useQuery({ queryKey: ["admin", "ops", "failures"], queryFn: () => api.listFailures(), retry: false });
  const rate = useQuery({ queryKey: ["admin", "ops", "fx"], queryFn: () => api.getFxRate(), retry: false });
  const [action, setAction] = useState("");
  const audit = useQuery({
    queryKey: ["admin", "ops", "audit", action],
    queryFn: () => api.listAuditTrail(action.trim() || undefined),
    retry: false,
  });

  const afterRate = () => queryClient.invalidateQueries({ queryKey: ["admin", "ops", "fx"] });
  const refresh = useMutation({ mutationFn: () => api.refreshFxRate(), onSuccess: afterRate });
  const setManual = useMutation({ mutationFn: (toman: number) => api.setFxRate(toman), onSuccess: afterRate });
  const [manual, setManual_] = useState("");

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
          نرخ دلار
        </h2>
        <p className="mt-1 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
          قیمت‌های تومانی از این نرخ می‌آید. هر ساعت خودکار به‌روز می‌شود؛ اگر منبع از دسترس خارج شده یا جهش بازار را رد کرده، از اینجا دستی
          بگیرش.
        </p>

        {rate.isPending ? <Muted>در حال خواندن…</Muted> : null}
        {rate.error ? <Muted>نرخ خوانده نشد.</Muted> : null}
        {rate.data === null ? <Muted>هیچ نرخی ثبت نشده.</Muted> : null}
        {rate.data ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl p-3"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <div>
              <div className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                تومان به ازای هر دلار
              </div>
              <div className="text-[17px] font-extrabold tabular-nums" dir="ltr" style={{ color: "var(--vg-text)" }}>
                {num(Math.round(rate.data.rialPerUsd / 10))}
              </div>
            </div>
            <div className="text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
              <div>
                منبع: <span dir="ltr">{rate.data.source ?? "—"}</span>
              </div>
              <div>از {when(rate.data.validFrom)}</div>
            </div>
            {canWriteFx ? (
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate()}
                  className="h-9 rounded-lg px-3 text-[12.5px] font-bold disabled:opacity-50"
                  style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                >
                  {refresh.isPending ? "در حال گرفتن…" : "تازه‌سازی از بازار"}
                </button>
                <input
                  value={manual}
                  onChange={(event) => setManual_(event.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="نرخ دستی"
                  aria-label="نرخ دستی به تومان"
                  className="h-9 w-32 rounded-lg px-2 text-[12.5px]"
                  style={{ background: "var(--vg-canvas)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
                />
                <button
                  type="button"
                  disabled={setManual.isPending || !/^\d{4,8}$/.test(manual.trim())}
                  onClick={() => setManual.mutate(Number(manual.trim()))}
                  className="h-9 rounded-lg px-3 text-[12.5px] disabled:opacity-40"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                >
                  ثبت دستی
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {refresh.error ? <Muted>منبع نرخ جواب نداد؛ می‌توانی دستی ثبت کنی.</Muted> : null}
        {setManual.error ? <Muted>ثبت نشد.</Muted> : null}
        {/* A hand-typed rate is a placeholder: the hourly job replaces it as
            soon as the market answers again. Worth saying, so nobody sets one
            and assumes it is pinned. */}
        {rate.data?.source === "manual" ? <Muted>این نرخ دستی است و اولین به‌روزرسانی موفق بعدی جایش را می‌گیرد.</Muted> : null}
      </section>

      <section>
        <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
          ساخت‌های ناموفق
        </h2>
        <p className="mt-1 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
          هر ساخت شکست‌خورده با دلیلی که ارائه‌دهنده داد. «برگشت» یعنی سکه‌ای کم نشده — کاری که سیستم روی هر شکست خودش انجام می‌دهد.
        </p>

        {failures.isPending ? <Muted>در حال خواندن…</Muted> : null}
        {failures.error ? <Muted>خوانده نشد.</Muted> : null}
        {failures.data?.length === 0 ? <Muted>در این فاصله چیزی شکست نخورده.</Muted> : null}
        {failures.data && failures.data.length > 0 ? (
          <Table head={["کِی", "مشتری", "مدل", "دلیل", "تلاش", "سکه"]}>
            {failures.data.map((job) => (
              <Row key={job.id}>
                <Cell dim>{when(job.at)}</Cell>
                <Cell dim>
                  <span dir="ltr">{job.customer ?? "—"}</span>
                </Cell>
                <Cell>
                  <span dir="ltr">{job.variantId ?? "—"}</span>
                </Cell>
                <Cell>
                  <span dir="ltr" className="block max-w-[320px] truncate" title={job.errorMessage ?? undefined}>
                    {job.errorCode ?? job.status}
                  </span>
                  {job.errorMessage ? (
                    <span dir="ltr" className="block max-w-[320px] truncate text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                      {job.errorMessage}
                    </span>
                  ) : null}
                </Cell>
                <Cell dim>{job.attempts}</Cell>
                <Cell>
                  <span style={{ color: job.refunded ? "var(--vg-primary-soft)" : "var(--vg-danger, #ff6c52)" }}>
                    {job.refunded ? "برگشت" : "کسر شده"}
                  </span>
                </Cell>
              </Row>
            ))}
          </Table>
        ) : null}
      </section>

      <section>
        <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
          دفتر تغییرات
        </h2>
        <p className="mt-1 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
          هر تغییری که از این پنل انجام شده، با نام کسی که انجامش داده. این همان چیزی است که بقیه‌ی صفحه‌ها وعده‌اش را می‌دهند.
        </p>

        <input
          type="search"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="فیلتر بر اساس نوع، مثل content. یا staff."
          aria-label="فیلتر دفتر تغییرات"
          dir="ltr"
          className="mt-2 h-9 w-full max-w-[320px] rounded-lg px-2.5 text-[12.5px]"
          style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />

        {audit.isPending ? <Muted>در حال خواندن…</Muted> : null}
        {audit.error ? <Muted>خوانده نشد.</Muted> : null}
        {audit.data?.length === 0 ? <Muted>چیزی ثبت نشده.</Muted> : null}
        {audit.data && audit.data.length > 0 ? (
          <Table head={["کِی", "کی", "کار", "هدف", "جزئیات"]}>
            {audit.data.map((entry) => (
              <Row key={entry.id}>
                <Cell dim>{when(entry.at)}</Cell>
                <Cell dim>
                  <span dir="ltr">{entry.actor ?? "—"}</span>
                </Cell>
                <Cell>
                  <span dir="ltr">{entry.action}</span>
                </Cell>
                <Cell dim>
                  <span dir="ltr" className="block max-w-[200px] truncate">
                    {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ""}` : "—"}
                  </span>
                </Cell>
                <Cell dim>
                  {entry.after ? (
                    <details>
                      <summary className="cursor-pointer text-[11.5px]">دیدن</summary>
                      <pre dir="ltr" className="mt-1 max-w-[320px] overflow-x-auto text-[10.5px] leading-4">
                        {JSON.stringify(entry.after, null, 1)}
                      </pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        ) : null}
      </section>
    </div>
  );
}
