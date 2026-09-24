import { useState } from "react";
import type { AdminApi, AnalyticsModality, AnalyticsWindow } from "../../features/admin/adminApi";
import { useModelMargin, useOverview, useProviderHealth } from "../../features/admin/useAdmin";
import { Chart, type SeriesPoint } from "./Sparkline";
import { Cell, Muted, Row, Stat, Table, num, toman, usd } from "./primitives";

/**
 * How the business is doing.
 *
 * Every figure here is read live out of Postgres at the moment the page loads.
 * `usage_daily` exists in the schema for a nightly rollup that nothing has ever
 * written to; with almost no rows yet, scanning the real tables is both correct
 * to the second and less machinery. The moment one of these gets slow, that
 * table is the answer.
 *
 * **Some of these are legitimately zero and say so.** There is no payment
 * gateway yet, so nothing has ever been sold — revenue is zero, and margin is
 * shown as "not selling yet" rather than as a large negative number that would
 * read as a business losing money. A dashboard that hides the difference
 * between "nothing happened" and "the query is broken" is worse than no
 * dashboard.
 */

const WINDOWS: { id: AnalyticsWindow; label: string }[] = [
  { id: "today", label: "امروز" },
  { id: "7d", label: "۷ روز" },
  { id: "30d", label: "۳۰ روز" },
  { id: "all", label: "از ابتدا" },
];

const MODALITIES: { id: AnalyticsModality; label: string }[] = [
  { id: undefined, label: "همه" },
  { id: "image", label: "تصویر" },
  { id: "video", label: "ویدیو" },
  { id: "audio", label: "صدا" },
];

/**
 * What the charts can draw.
 *
 * All five come out of one query that has always returned them — `providerCost`
 * and `newUsers` were fetched and thrown away from the day this page shipped,
 * and the jobs split is one extra column. So this is four more readings of the
 * same request rather than four more requests.
 *
 * `newUsers` is not split by modality, because a signup has not made anything
 * yet; the picker drops it while a modality is chosen rather than showing the
 * same unfiltered line under a filtered heading.
 */
type MetricId = "jobs" | "coins" | "cost" | "users";

const METRICS: {
  id: MetricId;
  label: string;
  unit?: string;
  kind: "bars" | "line";
  /** False for anything the modality filter cannot narrow. */
  byModality: boolean;
  of: (point: DailyPoint) => SeriesPoint;
}[] = [
  {
    id: "jobs",
    label: "جاب",
    unit: "جاب",
    kind: "bars",
    byModality: true,
    of: (point) => ({ label: point.day, value: point.jobs, part: point.jobsFailed }),
  },
  {
    id: "coins",
    label: "سکه",
    unit: "سکه",
    kind: "line",
    byModality: true,
    of: (point) => ({ label: point.day, value: point.coinsSpent }),
  },
  {
    id: "cost",
    label: "هزینهٔ ارائه‌دهنده",
    unit: "$",
    kind: "line",
    byModality: true,
    of: (point) => ({ label: point.day, value: point.providerCostUsd }),
  },
  {
    id: "users",
    label: "کاربر تازه",
    unit: "کاربر",
    kind: "bars",
    byModality: false,
    of: (point) => ({ label: point.day, value: point.newUsers }),
  },
];

type DailyPoint = {
  day: string;
  jobs: number;
  jobsSucceeded: number;
  jobsFailed: number;
  coinsSpent: number;
  providerCostUsd: number;
  newUsers: number;
};

/** A pill group. The window switch was the only one; there are three now. */
function Pills<T extends string | undefined>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id ?? "all"}
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className="h-7 rounded-lg px-2.5 text-[12px] font-semibold"
          style={{
            background: value === option.id ? "var(--vg-primary-a18)" : "var(--vg-surface)",
            color: value === option.id ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
            border: "1px solid var(--vg-border-subtle)",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardSection({ api }: { api: AdminApi }) {
  const [window, setWindow] = useState<AnalyticsWindow>("30d");
  const [modality, setModality] = useState<AnalyticsModality>(undefined);
  // Two charts, so two metrics, so that one screen can hold a comparison —
  // jobs against the coins they earned is the pair somebody actually wants.
  const [left, setLeft] = useState<MetricId>("jobs");
  const [right, setRight] = useState<MetricId>("coins");

  const overview = useOverview(api, window, modality, true);
  const models = useModelMargin(api, window, modality, true);
  const providers = useProviderHealth(api, window, true);

  const available = METRICS.filter((metric) => metric.byModality || modality === undefined);
  const metricOf = (id: MetricId) => available.find((metric) => metric.id === id) ?? available[0]!;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Pills options={WINDOWS} value={window} onChange={setWindow} label="بازه" />
        <Pills
          options={MODALITIES}
          value={modality}
          onChange={(next) => {
            setModality(next);
            // Signups are not video. Fall back rather than draw an unfiltered
            // line under a filtered heading.
            if (next !== undefined) {
              if (!METRICS.find((metric) => metric.id === left)?.byModality) setLeft("jobs");
              if (!METRICS.find((metric) => metric.id === right)?.byModality) setRight("coins");
            }
          }}
          label="نوع خروجی"
        />
        <span className="ms-auto text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
          روزها به وقت تهران
        </span>
      </div>

      {overview.isPending ? <Muted>در حال خواندن…</Muted> : null}
      {overview.error ? <Muted>آمار خوانده نشد.</Muted> : null}

      {overview.data ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="سکه‌ی فروخته‌شده" value={num(overview.data.totals.coinsSold)} hint="خریداری‌شده، نه هدیه" />
            <Stat label="سکه‌ی هدیه‌شده" value={num(overview.data.totals.coinsGranted)} hint="کد دعوت، تخفیف، اصلاح دستی" />
            <Stat label="سکه‌ی خرج‌شده" value={num(overview.data.totals.coinsSpent)} />
            <Stat
              label="درآمد"
              value={overview.data.totals.revenueIrr === 0 ? "0" : toman(overview.data.totals.revenueIrr)}
              hint={overview.data.totals.revenueIrr === 0 ? "هنوز درگاه پرداخت وصل نیست" : undefined}
            />
            <Stat label="هزینه‌ی ارائه‌دهنده" value={usd(overview.data.totals.providerCostUsd)} />
            <Stat
              label="حاشیه‌ی سود"
              value={overview.data.totals.grossMarginUsd === null ? "—" : usd(overview.data.totals.grossMarginUsd)}
              hint={overview.data.totals.grossMarginUsd === null ? "تا وقتی فروشی نباشد، حاشیه‌ای هم نیست" : "درآمد منهای هزینه"}
              {...(overview.data.totals.grossMarginUsd !== null && overview.data.totals.grossMarginUsd < 0 ? { tone: "bad" as const } : {})}
            />
            <Stat
              label="جاب‌ها"
              value={num(overview.data.totals.jobs)}
              hint={`${num(overview.data.totals.jobsSucceeded)} موفق · ${num(overview.data.totals.jobsFailed)} ناموفق`}
              {...(overview.data.totals.jobsFailed > overview.data.totals.jobsSucceeded && overview.data.totals.jobs > 0
                ? { tone: "bad" as const }
                : {})}
            />
            <Stat
              label="کاربران فعال"
              value={num(overview.data.totals.activeUsers)}
              hint={`${num(overview.data.totals.newUsers)} ثبت‌نام تازه`}
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { metric: metricOf(left), set: setLeft, label: "سنجهٔ نمودار چپ" },
              { metric: metricOf(right), set: setRight, label: "سنجهٔ نمودار راست" },
            ].map(({ metric, set, label }) => (
              <div key={label}>
                <div className="mb-1.5">
                  <Pills
                    options={available.map((entry) => ({ id: entry.id, label: entry.label }))}
                    value={metric.id}
                    onChange={set}
                    label={label}
                  />
                </div>
                <Chart
                  title={`${metric.label} در هر روز`}
                  points={overview.data!.daily.map(metric.of)}
                  kind={metric.kind}
                  {...(metric.unit ? { unit: metric.unit } : {})}
                  {...(metric.id === "jobs" ? { partLabel: "ناموفق" } : {})}
                />
              </div>
            ))}
          </div>

          {/* Standing totals, not windowed: what is true right now rather than
              what happened lately. Coins outstanding is a liability — generations
              already paid for and not yet taken. */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="سکه‌ی در دست کاربران" value={num(overview.data.standing.coinsOutstanding)} hint="بدهی، نه درآمد" />
            <Stat label="سکه‌ی رزرو‌شده" value={num(overview.data.standing.coinsHeld)} hint="جاب‌های در حال اجرا" />
            <Stat label="کاربران" value={num(overview.data.standing.users)} />
            <Stat
              label="کاربران مسدود"
              value={num(overview.data.standing.bannedUsers)}
              {...(overview.data.standing.bannedUsers > 0 ? { tone: "bad" as const } : {})}
            />
          </div>
        </>
      ) : null}

      <h3 className="mt-6 text-[13.5px] font-bold" style={{ color: "var(--vg-text)" }}>
        مدل‌ها و حاشیه‌ی سود
        {modality ? (
          <span className="ms-1.5 text-[11.5px] font-normal" style={{ color: "var(--vg-text-faint)" }}>
            — فقط {MODALITIES.find((entry) => entry.id === modality)?.label}
          </span>
        ) : null}
      </h3>
      <p className="mb-2 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
        بر اساس مدلی که مشتری انتخاب کرده، نه مدلی که اجرایش کرده. «هزینه» یعنی آنچه ارائه‌دهنده از ما گرفته است.
      </p>
      {models.data && models.data.length > 0 ? (
        <Table head={["مدل", "ارائه‌دهنده", "جاب", "سکه", "هزینه", "شکست", "میانگین"]}>
          {models.data.map((model) => {
            const failureRate = model.jobs === 0 ? 0 : model.failed / model.jobs;
            return (
              <Row key={`${model.name}-${model.providerCode}`}>
                <Cell>{model.name}</Cell>
                <Cell dim>
                  <span dir="ltr">{model.providerCode}</span>
                </Cell>
                <Cell>{num(model.jobs)}</Cell>
                <Cell>{num(model.coinsCharged)}</Cell>
                <Cell>
                  <span dir="ltr">{usd(model.providerCostUsd)}</span>
                </Cell>
                <Cell>
                  <span style={{ color: failureRate > 0.1 ? "var(--vg-danger, #ff6c52)" : "var(--vg-text-faint)" }} dir="ltr">
                    {model.jobs === 0 ? "—" : `${Math.round(failureRate * 100)}%`}
                  </span>
                </Cell>
                <Cell dim>
                  <span dir="ltr">{model.avgSeconds === null ? "—" : `${model.avgSeconds.toFixed(1)}s`}</span>
                </Cell>
              </Row>
            );
          })}
        </Table>
      ) : (
        <Muted>{models.isPending ? "در حال خواندن…" : "در این بازه هیچ جابی اجرا نشده است."}</Muted>
      )}

      <h3 className="mt-6 text-[13.5px] font-bold" style={{ color: "var(--vg-text)" }}>
        سلامت ارائه‌دهنده‌ها
      </h3>
      <p className="mb-2 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
        از روی تلاش‌ها شمرده می‌شود، نه جاب‌ها — یک جاب می‌تواند چند تلاش روی چند ارائه‌دهنده داشته باشد، و شمردن جاب‌ها موفقیتِ یک تلاش دوم
        را به حساب کسی می‌گذارد که اول شکست خورده بود.
      </p>
      {providers.data ? (
        <Table head={["ارائه‌دهنده", "تلاش", "موفق", "ناموفق", "میانگین تأخیر", "هزینه"]}>
          {providers.data.map((provider) => (
            <Row key={provider.providerCode}>
              <Cell>
                {provider.providerName}
                <span className="ms-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
                  {provider.providerCode}
                </span>
              </Cell>
              <Cell>{num(provider.attempts)}</Cell>
              <Cell>{num(provider.succeeded)}</Cell>
              <Cell>
                <span style={{ color: provider.failed > 0 ? "var(--vg-danger, #ff6c52)" : "var(--vg-text-faint)" }}>
                  {num(provider.failed)}
                </span>
              </Cell>
              <Cell dim>
                <span dir="ltr">{provider.avgLatencyMs === null ? "—" : `${Math.round(provider.avgLatencyMs)}ms`}</span>
              </Cell>
              <Cell dim>
                <span dir="ltr">{usd(provider.providerCostUsd)}</span>
              </Cell>
            </Row>
          ))}
        </Table>
      ) : (
        <Muted>{providers.isPending ? "در حال خواندن…" : "خوانده نشد."}</Muted>
      )}
    </div>
  );
}
