/**
 * What a tab shows while its screen is still arriving.
 *
 * Every nav destination is its own route, so switching tabs fetches that
 * route's payload and its chunk before React has anything to render. On a
 * throttled connection that measured 1.2 to 7.8 seconds during which the URL
 * had not changed and not one pixel had moved — the click read as ignored, and
 * people pressed again. A `loading.tsx` lets Next commit the navigation at
 * once and show this instead, so the tab highlights immediately and the shape
 * of the screen is already on the page when the screen itself lands.
 *
 * Two shapes, because the nav has two: the studios are a canvas with a dock
 * under it, everything else is a heading over a grid. The point is to hold the
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

export function ScreenSkeleton({ variant }: { variant: "work" | "page" }) {
  return (
    // aria-busy with no inner text: a screen reader is told the region is
    // loading once, rather than reading out a dozen empty boxes.
    <div
      role="status"
      aria-busy="true"
      aria-label="در حال بارگذاری"
      className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 py-6 md:px-6"
    >
      {variant === "work" ? <Work /> : <Page />}
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
