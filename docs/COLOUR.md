# Colour

How much colour the product uses, and how to check it. The values live in
`src/design-system/tokens.css`; this file is the method behind them.

Last measured 2026-08-22.

## The rule

Two numbers, both measurable in a browser:

|                                                                | Target | Why                                                                                   |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| **Colour budget** — saturated share of the page's painted area | ~4%    | Below ~2% the page reads grey. Above ~6% it reads like a toy.                         |
| **Concentration** — the primary's share of that colour         | 90%+   | This is what makes one hue read as _the brand_ rather than as one of several accents. |

Everything that is not the primary is neutral. The accent, the reward and the
plan marks each carry one specific meaning and are deliberately small.

This replaced an older rule that said "on a screen with two primary-filled
elements, one of them is wrong". That rule counted elements, which is the wrong
unit — it is satisfied perfectly by a page with no brand colour on it at all,
and that is exactly what we had.

## What "fill more things" does and does not mean

The budget goes up by giving the primary **area in high-attention positions**,
not by sprinkling it. In practice that is a small number of large surfaces:

- the promotional bar, as a solid fill with near-black ink
- the primary CTA
- the selected state of a binary control
- the recommended item in a set

It does **not** mean tinting borders, adding glows, or colouring body text.
Those raise the count and not the area, and they make the page noisier without
making it more branded.

## Ink on the fill is near-black, never white

The single most copyable thing about the reference. A bright fill with white
text looks like a highlighter; the same fill with near-black text looks like a
material the interface is made of.

On our lime it is not even a choice: white measures **1.27:1** and is illegal.
`--vg-text-on-primary` measures **14.5:1**.

Any surface that flips to the primary fill must flip its whole contents —
`--color-ink*` are all built for a dark ground and none of them are legible on
the lime. See `.plans-festival-banner` for the worked example.

## How to measure

Load the page, open the console, and run:

```js
(() => {
  const chroma = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
  const parse = (c) => {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
  let painted = 0;
  const fills = {};
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (!area) return;
    const s = getComputedStyle(el);
    const bg = parse(s.backgroundColor);
    if (bg && bg.a >= 0.05) {
      painted += area * bg.a;
      if (chroma(bg.r, bg.g, bg.b) >= 40) fills[hex(bg)] = (fills[hex(bg)] || 0) + area * bg.a;
    }
    if (s.backgroundImage && s.backgroundImage !== "none") {
      const stops = (s.backgroundImage.match(/rgba?\([^)]+\)/g) || [])
        .map(parse)
        .filter((c) => c && c.a >= 0.5 && chroma(c.r, c.g, c.b) >= 40);
      if (stops.length) {
        const best = stops.sort((a, b) => chroma(b.r, b.g, b.b) - chroma(a.r, a.g, a.b))[0];
        fills[hex(best)] = (fills[hex(best)] || 0) + area;
        painted += area;
      }
    }
  });
  const total = Object.values(fills).reduce((a, b) => a + b, 0);
  return {
    budget: +((100 * total) / painted).toFixed(2) + "%",
    breakdown: Object.entries(fills)
      .sort((a, b) => b[1] - a[1])
      .map(([h, a]) => [h, +((100 * a) / total).toFixed(1) + "% of colour"]),
  };
})();
```

Notes on the method, so results stay comparable:

- **Chroma ≥ 40** (max channel − min channel) is the line between "a colour"
  and "a neutral". Our surface ladder is cool-tinted and must not count.
- **Gradients** attribute the element's whole area to their most saturated
  stop. Without this the CTA — the most important coloured element on the
  page — scores zero, because it has no `background-color` at all.
- **Alpha weights the area.** A 10% tint over a card is not the same
  contribution as a solid fill.
- Text colour is deliberately excluded. Count it separately if you want it;
  area is what governs whether a page looks branded.

## Measurements

|                           | Budget | Primary's share |
| ------------------------- | ------ | --------------- |
| Reference (higgsfield.ai) | 4.28%  | 97%             |
| `/plans` before           | 2.50%  | 7%              |
| `/plans` now              | 3.45%  | 98.6%           |

The 7% is not a typo. The primary painted **zero** elements: `.plans-modern-cta`
was three literal oranges left from before the DEEV rebrand, so the loudest
thing on the pricing page was a colour the design system did not contain.

## Contrast floors

Checked, not assumed. AA is 4.5:1 for body text and 3:1 for large text and UI.

| Pair                                          | Ratio                    |
| --------------------------------------------- | ------------------------ |
| `--vg-text-on-primary` on the lime fill       | 14.5                     |
| lime as text on `--vg-canvas`                 | 14.98                    |
| `--vg-reward` amber as text on `--vg-surface` | 11.18                    |
| `--vg-text-on-reward` on the amber fill       | 10.49                    |
| plan marks as text on `--vg-surface`          | 5.4 – 13.8               |
| white on the lime fill                        | **1.27 — never do this** |
