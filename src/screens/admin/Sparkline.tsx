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
 */

interface SeriesProps {
  values: number[];
  labels?: string[];
  height?: number;
  className?: string;
  /** What the shape is, for anyone who cannot see it. */
  title: string;
}

const WIDTH = 300;

/** Nothing to draw yet, said as a shape rather than as an empty box. */
function Empty({ height, title }: { height: number; title: string }) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={`${title} — بدون داده`} preserveAspectRatio="none">
      <line x1="0" y1={height - 1} x2={WIDTH} y2={height - 1} stroke="var(--vg-border-subtle)" strokeWidth="1" />
    </svg>
  );
}

export function Sparkline({ values, height = 40, className, title }: SeriesProps) {
  if (values.length < 2) return <Empty height={height} title={title} />;

  const peak = Math.max(...values, 0);
  // A flat zero series is a horizontal line on the floor, not a division by
  // zero and not a line through the middle pretending to be data.
  const scale = peak === 0 ? 0 : (height - 2) / peak;
  const step = WIDTH / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(2)},${(height - 1 - value * scale).toFixed(2)}`);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className={`w-full ${className ?? ""}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="none"
    >
      <polyline
        points={`0,${height - 1} ${points.join(" ")} ${WIDTH},${height - 1}`}
        fill="var(--vg-primary-a18)"
        stroke="none"
        opacity={0.5}
      />
      <polyline points={points.join(" ")} fill="none" stroke="var(--vg-primary-soft)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * One bar per day, with the last one marked.
 *
 * Bars rather than a line where the reading is "how much on each day" instead
 * of "which way is it going" — a line implies the days in between mean
 * something, and between two daily totals nothing does.
 */
export function Bars({ values, labels, height = 56, title }: SeriesProps) {
  if (values.length === 0) return <Empty height={height} title={title} />;

  const peak = Math.max(...values, 0);
  const scale = peak === 0 ? 0 : (height - 2) / peak;
  const slot = WIDTH / values.length;
  const width = Math.max(1, slot * 0.68);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={title}>
      {values.map((value, index) => {
        const barHeight = Math.max(value > 0 ? 1 : 0, value * scale);
        const last = index === values.length - 1;
        return (
          <rect
            key={labels?.[index] ?? index}
            x={index * slot + (slot - width) / 2}
            y={height - 1 - barHeight}
            width={width}
            height={barHeight}
            rx={Math.min(1.5, width / 2)}
            fill={last ? "var(--vg-primary-soft)" : "var(--vg-primary-a18)"}
          >
            {labels?.[index] ? <title>{`${labels[index]}: ${value.toLocaleString("en-US")}`}</title> : null}
          </rect>
        );
      })}
      <line x1="0" y1={height - 1} x2={WIDTH} y2={height - 1} stroke="var(--vg-border-subtle)" strokeWidth="1" />
    </svg>
  );
}
