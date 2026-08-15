import { BRAND } from "../data/brand";

export function AppLoading({ label = "در حال آماده‌سازی فضای کار…" }: { label?: string | undefined }) {
  return (
    <main className="min-h-[100dvh] bg-surface text-ink" aria-busy="true" aria-label={label}>
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[var(--vg-container-max)] items-center justify-between">
          <span className="text-[17px] font-bold" style={{ fontFamily: "var(--vg-font-display)" }}>
            {BRAND.name}
          </span>
          <span className="t-ghost" lang="en">
            LOADING WORKSPACE
          </span>
        </div>
      </header>
      <div className="mx-auto grid max-w-[var(--vg-container-max)] gap-4 px-4 py-6 sm:px-6 md:grid-cols-[300px_1fr]">
        <aside className="space-y-3 rounded-card border border-line bg-card p-4">
          <div className="shimmer aspect-[16/10] rounded-md bg-raised" />
          <div className="shimmer h-11 rounded-md bg-raised" />
          <div className="shimmer h-24 rounded-md bg-raised" />
          <div className="shimmer h-11 rounded-md bg-raised" />
        </aside>
        <section className="grid min-h-[56dvh] place-items-center rounded-card border border-line bg-card p-6 text-center">
          <div>
            <div className="mx-auto size-10 animate-pulse rounded-full border border-line bg-raised" />
            <p className="mt-4 text-[13px] text-ink2">{label}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
