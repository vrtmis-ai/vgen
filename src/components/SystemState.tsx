import { ArrowLeft, ArrowsClockwise, House, WarningOctagon, WifiSlash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { BRAND } from "../data/brand";

export type SystemStateKind = "not-found" | "offline" | "service";

interface StateCopy {
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel: string;
  icon: ReactNode;
}

const COPY: Record<SystemStateKind, StateCopy> = {
  "not-found": {
    code: "404",
    eyebrow: "ROUTE LOST",
    title: "این مسیر به جایی نمی‌رسد",
    description: "ممکن است آدرس تغییر کرده باشد یا صفحه‌ای که دنبالش هستی هنوز ساخته نشده باشد.",
    primaryLabel: "بازگشت به استودیو",
    icon: <House size={19} weight="bold" />,
  },
  offline: {
    code: "OFF",
    eyebrow: "NO SIGNAL",
    title: "اینترنت در دسترس نیست",
    description: "اتصال دستگاهت را بررسی کن. چیزی از دست نرفته؛ بعد از وصل‌شدن می‌توانی دقیقاً از همین‌جا ادامه بدهی.",
    primaryLabel: "بررسی دوباره",
    icon: <WifiSlash size={19} weight="bold" />,
  },
  service: {
    code: "503",
    eyebrow: "SERVICE INTERRUPTED",
    title: "ارتباط با سرویس قطع شد",
    description: "فضای کاری نتوانست داده‌های لازم را دریافت کند. دوباره تلاش کن؛ اگر ادامه داشت، کد پیگیری را برای پشتیبانی بفرست.",
    primaryLabel: "تلاش دوباره",
    icon: <ArrowsClockwise size={19} weight="bold" />,
  },
};

export function SystemState({
  kind,
  onPrimary,
  onSecondary,
  requestId,
  title,
  description,
  primaryLabel,
  busy = false,
}: {
  kind: SystemStateKind;
  onPrimary?: (() => void) | undefined;
  onSecondary?: (() => void) | undefined;
  requestId?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  primaryLabel?: string | undefined;
  busy?: boolean | undefined;
}) {
  const copy = COPY[kind];
  return (
    <main className="relative isolate grid min-h-[100dvh] overflow-hidden bg-surface px-5 py-6 text-ink sm:px-8">
      <div
        className="pointer-events-none absolute inset-0 -z-20 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / .025) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .025) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black, transparent 72%)",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -start-24 top-1/4 -z-10 h-80 w-80 rounded-full blur-[100px]"
        style={{ background: "var(--vg-primary-a10)" }}
        aria-hidden
      />

      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between self-start">
        <span className="text-[18px] font-bold tracking-tight" style={{ fontFamily: "var(--vg-font-display)" }}>
          {BRAND.name}
        </span>
        <span className="t-ghost" lang="en">
          SYSTEM STATUS
        </span>
      </header>

      <section className="mx-auto grid w-full max-w-[980px] self-center overflow-hidden rounded-bezel border border-line bg-card md:grid-cols-[1fr_280px]">
        <div className="order-2 flex flex-col justify-center p-6 sm:p-10 md:order-1 md:p-14">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink3" lang="en">
            <WarningOctagon size={15} weight="fill" className="text-accent" />
            {copy.eyebrow}
          </div>
          <h1 className="mt-5 max-w-[16ch] text-[26px] font-bold leading-[1.4] text-ink sm:text-[34px]">{title ?? copy.title}</h1>
          <p className="mt-3 max-w-[54ch] text-[13px] leading-7 text-ink2 sm:text-[15px]">{description ?? copy.description}</p>

          {requestId && (
            <div className="mt-6 flex w-fit max-w-full items-center gap-2 rounded-md border border-line bg-raised px-3 py-2" dir="ltr">
              <span className="text-[10px] font-bold tracking-[0.12em] text-ink3">REQUEST ID</span>
              <code className="truncate text-[11px] text-ink2">{requestId}</code>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-2.5">
            {onPrimary && (
              <button
                type="button"
                onClick={onPrimary}
                disabled={busy}
                className="btn-accent inline-flex min-h-11 items-center gap-2 rounded-md px-5 text-[13px] font-bold disabled:opacity-60"
              >
                {busy ? <ArrowsClockwise size={19} className="animate-spin" /> : copy.icon}
                {busy ? "در حال بررسی…" : (primaryLabel ?? copy.primaryLabel)}
              </button>
            )}
            {onSecondary && (
              <button
                type="button"
                onClick={onSecondary}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-raised px-5 text-[13px] font-semibold text-ink2 transition-colors hover:bg-card2 hover:text-ink"
              >
                صفحه قبل
                <ArrowLeft size={17} weight="bold" />
              </button>
            )}
          </div>
        </div>

        <div className="order-1 relative grid min-h-48 place-items-center overflow-hidden border-b border-line bg-raised md:order-2 md:min-h-[440px] md:border-b-0 md:border-s">
          <div className="absolute inset-0 opacity-40" style={{ background: "var(--vg-cool-leak)" }} aria-hidden />
          <span
            className="relative select-none text-[88px] font-bold leading-none tracking-[-0.08em] text-ink sm:text-[112px] md:-rotate-90"
            style={{ fontFamily: "var(--vg-font-mono)", textShadow: "0 0 48px rgb(255 255 255 / .08)" }}
            aria-hidden
          >
            {copy.code}
          </span>
          <span className="absolute bottom-5 start-5 text-[10px] tracking-[0.18em] text-ink3" lang="en">
            DEEV / RECOVERY
          </span>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[1180px] items-center justify-between self-end text-[11px] text-ink3">
        <span>فضای ساخت امن است</span>
        <span lang="en">STATUS.DEEV</span>
      </footer>
    </main>
  );
}
