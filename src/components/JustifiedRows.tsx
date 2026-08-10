import { useEffect, useMemo, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   Justified rows — the layout the image wall actually uses.

   Measured off /ai/image rather than guessed. Two rows from that page:

     h=185  ars [0.56, 0.75, 1.78, 1.78, 1.78, 1.78, 1.78]  sum 1893px
     h=481  ars [0.56 x 7]                                   sum 1890px

   Both fill the container exactly, and the heights differ. So it is not a grid:
   every image keeps its true aspect ratio, a row shares one height, and the
   height is whatever makes that row's widths add up to the container. Google
   Photos does this; a CSS grid cannot.

   The difference is not cosmetic. A uniform `aspect-[3/4]` grid — which is what
   we had — crops every 16:9 and every 9:16 to fit the cell. On a page whose
   entire job is letting you judge an image you just paid for, showing you a
   cropped version of it is the wrong default.

   The density control sets `targetHeight`: taller rows mean fewer, bigger
   images per row.
   --------------------------------------------------------------------------- */

export interface JustifiedItem {
  key: string;
  /** width / height. Anything <= 0 is treated as square rather than dropped. */
  ratio: number;
}

/** Greedy fill: add items until the row overshoots, then scale it to fit. */
function layout<T extends JustifiedItem>(items: T[], containerWidth: number, targetHeight: number, gap: number) {
  const rows: { items: T[]; height: number }[] = [];
  let row: T[] = [];
  let ratioSum = 0;

  const flush = (isLast: boolean) => {
    if (!row.length) return;
    const gaps = gap * (row.length - 1);
    const usable = containerWidth - gaps;
    // The last row keeps the target height rather than stretching a single
    // orphan image across the full width, which looks like a mistake.
    const height = isLast && ratioSum * targetHeight < usable ? targetHeight : usable / ratioSum;
    rows.push({ items: row, height });
    row = [];
    ratioSum = 0;
  };

  for (const it of items) {
    const r = it.ratio > 0 ? it.ratio : 1;
    row.push(it);
    ratioSum += r;
    // Overshoot check uses the gaps this row would need.
    if (ratioSum * targetHeight + gap * (row.length - 1) >= containerWidth) flush(false);
  }
  flush(true);
  return rows;
}

export function JustifiedRows<T extends JustifiedItem>({
  items,
  targetHeight,
  gap = 1,
  render,
}: {
  items: T[];
  targetHeight: number;
  gap?: number;
  render: (item: T, size: { width: number; height: number }) => React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // ResizeObserver rather than a window listener: the wall sits beside a panel
  // that can appear and disappear, so the container changes width without the
  // window ever resizing.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(
    () => (width > 0 ? layout(items, width, targetHeight, gap) : []),
    [items, width, targetHeight, gap],
  );

  return (
    <div ref={host} className="flex flex-col" style={{ gap }}>
      {rows.map((r, i) => (
        <div key={i} className="flex" style={{ gap }}>
          {r.items.map((it) => (
            <div key={it.key} style={{ width: (it.ratio > 0 ? it.ratio : 1) * r.height, height: r.height }}>
              {render(it, { width: (it.ratio > 0 ? it.ratio : 1) * r.height, height: r.height })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
