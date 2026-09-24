import { useState } from "react";

/**
 * Charts, as inline SVG.
 *
 * No charting library. A dashboard's charts are a line and some bars, the theme
 * tokens are already CSS variables an SVG can read directly, and adding ~100KB
 * plus a dependency for four shapes on a page four people open is not a trade
 * worth making — especially on a public repository where every dependency is
 * now something Dependabot has to watch.
 *
 * **These deliberately draw from zero.** A sparkline scaled to its own minimum
 * makes a flat series look dramatic, which is exactly the lie a small chart is
 * best at telling. The y-axis here always starts at 0, so a quiet week looks
 * quiet.
 *
 * **Every label lives in HTML, outside the SVG.** The viewBox is stretched with
 * `preserveAspectRatio="none"` so one geometry fits any width, which distorts
 * anything drawn in it — text included. Putting the axis maximum, the day
 * labels and the hover readout in the markup around the picture sidesteps that
 * entirely, and they inherit the page's font while they are at it.
 */

export interface SeriesPoint {
  /** The Tehran day, `YYYY-MM-DD`. */
  label: string;
  value: number;
  /**
   * Drawn on top of `value` in the warning colour — the failed share of a day.
   *
   * Part of `value`, not added to it: a day of 10 jobs with 3 failures is
   * `{ value: 10, part: 3 }`, so the bar's height stays "how much happened"
   * and the shading says how much of it went wrong.
   */
  part?: number;
}

const WIDTH = 300;

/** Latin digits, matching every other number in the panel. */
const fmt = (value: number): string => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * A titled panel with a chart in it, the axis maximum, the days at each end,
 * and a readout that follows the pointer.
 *
 * The readout is the reason this wrapper exists. `Bars` had a `<title>` per
 * rect, which is a browser tooltip after a second's hover — and the line chart
 * was passed no labels at all, so a point on it could not be read even in
 * principle.
 */
export function Chart({
  title,
  points,
  kind,
  unit,
  partLabel,
  height = 64,
}: {
  title: string;
  points: SeriesPoint[];
  kind: "bars" | "line";
  /** Suffixed to the readout — "جاب", "سکه", "$". */
  unit?: string;
  /** What the shaded share means, when the points carry one. */
  partLabel?: string;
  height?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = Math.max(...points.map((point) => point.value), 0);
  const at = hovered === null ? null : points[hovered];
  const hasParts = points.some((point) => point.part !== undefined);

  /* The index under the pointer, from where it is across the box. One handler
     on the wrapper rather than an invisible element per day: at thirty points
     that is thirty more nodes for the same answer. */
  const track = (event: React.MouseEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    // Zero-width while hidden, and a NaN index would blank the readout rather
    // than leave the last honest one on screen.
    if (!Number.isFinite(ratio)) return;
    setHovered(Math.min(points.length - 1, Math.max(0, Math.floor(ratio * points.length))));
  };

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
      <div className="mb-1.5 flex items-baseline gap-2 text-[11px]">
        <span style={{ color: "var(--vg-text-faint)" }}>{title}</span>
        {hasParts && partLabel ? (
          <span className="flex items-center gap-1" style={{ color: "var(--vg-text-faint)" }}>
            <span className="inline-block size-2 rounded-[2px]" style={{ background: "var(--vg-danger, #ff6c52)" }} />
            {partLabel}
          </span>
        ) : null}
        {/* The readout sits where the eye already is — beside the title, not in
            a floating box that covers the shape it describes. */}
        <span className="ms-auto tabular-nums" style={{ color: at ? "var(--vg-text)" : "var(--vg-text-faint)" }} dir="ltr">
          {at ? `${at.label} · ${fmt(at.value)}${unit ? ` ${unit}` : ""}${at.part ? ` (${fmt(at.part)})` : ""}` : `max ${fmt(peak)}`}
        </span>
      </div>

      <div onMouseMove={track} onMouseLeave={() => setHovered(null)}>
        {kind === "bars" ? (
          <Bars points={points} height={height} title={title} hovered={hovered} />
        ) : (
          <Sparkline points={points} height={height} title={title} hovered={hovered} />
        )}
      </div>

      {points.length > 1 ? (
        <div className="mt-1 flex justify-between text-[10.5px] tabular-nums" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
          <span>{points[0]!.label}</span>
          <span>{points[points.length - 1]!.label}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Nothing to draw yet, said as a shape rather than as an empty box. */
function Empty({ height, title }: { height: number; title: string }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={`${title} — بدون داده`} preserveAspectRatio="none">
      <line x1="0" y1={height - 1} x2={WIDTH} y2={height - 1} stroke="var(--vg-border-subtle)" strokeWidth="1" />
    </svg>
  );
}

interface ShapeProps {
  points: SeriesPoint[];
  height: number;
  title: string;
  hovered: number | null;
}

export function Sparkline({ points, height, title, hovered }: ShapeProps) {
  if (points.length < 2) return <Empty height={height} title={title} />;

  const peak = Math.max(...points.map((point) => point.value), 0);
  // A flat zero series is a horizontal line on the floor, not a division by
  // zero and not a line through the middle pretending to be data.
  const scale = peak === 0 ? 0 : (height - 2) / peak;
  const step = WIDTH / (points.length - 1);
  const xy = points.map((point, index) => [index * step, height - 1 - point.value * scale] as const);
  const path = xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  const marker = hovered === null ? undefined : xy[hovered];

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={title} preserveAspectRatio="none">
      <polyline
        points={`0,${height - 1} ${path.join(" ")} ${WIDTH},${height - 1}`}
        fill="var(--vg-primary-a18)"
        stroke="none"
        opacity={0.5}
      />
      <polyline points={path.join(" ")} fill="none" stroke="var(--vg-primary-soft)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {marker ? (
        <>
          <line
            x1={marker[0]}
            y1={0}
            x2={marker[0]}
            y2={height - 1}
            stroke="var(--vg-border-subtle)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* A circle in a stretched viewBox would render as an ellipse, so the
              marker is a round-capped zero-length stroke instead. */}
          <line
            x1={marker[0]}
            y1={marker[1]}
            x2={marker[0]}
            y2={marker[1]}
            stroke="var(--vg-primary-soft)"
            strokeWidth="5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
    </svg>
  );
}

/**
 * One bar per day, with the hovered one marked.
 *
 * Bars rather than a line where the reading is "how much on each day" instead
 * of "which way is it going" — a line implies the days in between mean
 * something, and between two daily totals nothing does.
 */
export function Bars({ points, height, title, hovered }: ShapeProps) {
  if (points.length === 0) return <Empty height={height} title={title} />;

  const peak = Math.max(...points.map((point) => point.value), 0);
  const scale = peak === 0 ? 0 : (height - 2) / peak;
  const slot = WIDTH / points.length;
  const width = Math.max(1, slot * 0.68);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={title}>
      {points.map((point, index) => {
        const barHeight = Math.max(point.value > 0 ? 1 : 0, point.value * scale);
        const partHeight = point.part ? Math.max(1, point.part * scale) : 0;
        const x = index * slot + (slot - width) / 2;
        const lit = hovered === index || (hovered === null && index === points.length - 1);
        return (
          <g key={point.label}>
            <rect
              x={x}
              y={height - 1 - barHeight}
              width={width}
              height={barHeight}
              rx={Math.min(1.5, width / 2)}
              fill={lit ? "var(--vg-primary-soft)" : "var(--vg-primary-a18)"}
            >
              <title>{`${point.label}: ${fmt(point.value)}`}</title>
            </rect>
            {/* The failed share, drawn on the floor of the bar it belongs to:
                the total is still the height, and the red says how much of that
                total was a refund rather than a picture. */}
            {partHeight > 0 ? (
              <rect
                x={x}
                y={height - 1 - partHeight}
                width={width}
                height={partHeight}
                rx={Math.min(1.5, width / 2)}
                fill="var(--vg-danger, #ff6c52)"
              >
                <title>{`${point.label}: ${fmt(point.part!)}`}</title>
              </rect>
            ) : null}
          </g>
        );
      })}
      <line x1="0" y1={height - 1} x2={WIDTH} y2={height - 1} stroke="var(--vg-border-subtle)" strokeWidth="1" />
    </svg>
  );
}
