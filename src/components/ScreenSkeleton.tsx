/**
 * What a route shows while its screen is still arriving.
 *
 * Every screen is its own route, so moving between them fetches that route's
 * payload and its chunk before React has anything to render. On a throttled
 * connection that measured 1.2 to 7.8 seconds during which the URL had not
 * changed and not one pixel had moved — the click read as ignored, and people
 * pressed again. A `loading.tsx` lets Next commit the navigation at once and
 * show this instead, so the destination is on screen immediately and the shape
 * of it is already there when the screen itself lands.
 *
 * Six shapes, one per kind of screen the site has. The point is to hold the
 * right space, not to draw the screen twice — a skeleton that tries to be
 * exact is a second copy of a layout that will drift away from the first.
 *
 * `.vg-skeleton` is the design system's own placeholder: surface, hairline,
 * and a light sweep that already reverses under RTL and stops under
 * `prefers-reduced-motion`.
 */
function Block({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`vg-skeleton ${className ?? ""}`} style={style} />;
}

export type SkeletonVariant = "work" | "page" | "prose" | "form" | "hero" | "dock";

const SHAPES: Record<SkeletonVariant, () => React.JSX.Element> = {
  work: Work,
  page: Page,
  prose: Prose,
  form: Form,
  hero: Hero,
  dock: Dock,
};

/** The full-bleed shapes lay themselves out; the rest sit in the page container. */
const FULL_BLEED: ReadonlySet<SkeletonVariant> = new Set<SkeletonVariant>(["hero", "form", "dock"]);

export function ScreenSkeleton({ variant }: { variant: SkeletonVariant }) {
  const Shape = SHAPES[variant];
  return (
    // aria-busy with no inner text: a screen reader is told the region is
    // loading once, rather than reading out a dozen empty boxes.
    <div
      role="status"
      aria-busy="true"
      aria-label="در حال بارگذاری"
      className={FULL_BLEED.has(variant) ? "w-full" : "mx-auto w-full max-w-[var(--vg-container-max)] px-4 py-6 md:px-6"}
    >
      <Shape />
    </div>
  );
}

/** The studios: a canvas that fills the space, with the dock floating under it. */
function Work() {
  return (
    <>
      <Block className="h-7 w-44" />
      <Block className="mt-5 w-full rounded-2xl" style={{ height: "min(52dvh, 420px)" }} />
      <div className="mt-6 flex flex-wrap gap-2.5">
        {[112, 92, 72, 128].map((w, i) => (
          <Block key={i} className="h-9 rounded-xl" style={{ width: w }} />
        ))}
      </div>
      <Block className="mt-6 h-28 w-full rounded-2xl" />
    </>
  );
}

/** Explore, gallery, community, effects, academy, mcp: a heading over cards. */
function Page() {
  return (
    <>
      <Block className="h-7 w-52" />
      <Block className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Block key={i} className="aspect-[4/3] w-full rounded-2xl" />
        ))}
      </div>
    </>
  );
}

/** The legal and explanatory pages: a title, then columns of prose. */
function Prose() {
  return (
    <div className="mx-auto max-w-[760px]">
      <Block className="h-8 w-64 max-w-full" />
      <Block className="mt-3 h-4 w-40" />
      {[5, 4, 6].map((lines, section) => (
        <div key={section} className="mt-9">
          <Block className="h-5 w-48 max-w-full" />
          <div className="mt-3.5">
            {Array.from({ length: lines }, (_, i) => (
              <Block key={i} className="vg-skeleton--text" style={{ inlineSize: i === lines - 1 ? "55%" : "100%" }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Sign in, sign up, reset, profile: one narrow column of fields, centred. */
function Form() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[400px]">
        <Block className="mx-auto h-7 w-44" />
        <Block className="mx-auto mt-3 h-4 w-60 max-w-full" />
        <div className="mt-8 flex flex-col gap-3">
          <Block className="h-12 w-full rounded-xl" />
          <Block className="h-12 w-full rounded-xl" />
          <Block className="h-12 w-full rounded-full" />
        </div>
        <Block className="mx-auto mt-6 h-4 w-40" />
      </div>
    </div>
  );
}

/** The invite gate: a centred stack with the field and its button side by side. */
function Hero() {
  return (
    <div className="flex min-h-[80dvh] flex-col items-center justify-center px-5 py-14">
      <Block className="h-7 w-44 rounded-full" />
      <Block className="mt-7 h-10 w-56" />
      <Block className="mt-6 h-11 w-[min(420px,90vw)]" />
      <Block className="mt-3 h-4 w-52" />
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Block className="h-12 w-[min(240px,70vw)] rounded-full" />
        <Block className="h-12 w-36 rounded-full" />
      </div>
      <Block className="mt-6 h-11 w-40 rounded-full" />
    </div>
  );
}

/** Generate and result: the settings dock beside a canvas, stacking on a phone. */
function Dock() {
  return (
    <div className="flex flex-col md:flex-row md:items-start">
      <aside className="flex w-full shrink-0 flex-col gap-2.5 p-2.5 md:w-[var(--vg-form-panel)]">
        <Block className="h-8 w-24 rounded-lg" />
        <Block className="h-44 w-full rounded-2xl" />
        <Block className="h-28 w-full rounded-2xl" />
        <Block className="h-32 w-full rounded-2xl" />
        <Block className="h-12 w-full rounded-xl" />
      </aside>
      <div className="min-w-0 flex-1 p-2.5">
        <Block className="h-5 w-40" />
        <Block className="mt-4 w-full rounded-2xl" style={{ height: "min(60dvh, 520px)" }} />
      </div>
    </div>
  );
}
