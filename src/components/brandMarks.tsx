/* ---------------------------------------------------------------------------
   The brand marks.

   Traced from the artwork sheet rather than re-drawn, so the wings keep their
   pixel steps, the D keeps its cut corner and the V keeps the weights it was
   drawn with. The letters take `currentColor`, which is what lets the same
   file sit white on the stage, dark on a lime button, or dimmed in a footer;
   the square is the brand's lime and never inherits — it is the one part of
   the mark that is a colour rather than ink.
   --------------------------------------------------------------------------- */

const LIME = "#C6F52E";

/** The full lockup: winged D, the letters, the square. */
export function Wordmark({ height = 20, title }: { height?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 1060.28 334.59"
      height={height}
      width={Math.round(height * 3.1689 * 100) / 100}
      role={title ? "img" : "presentation"}
      {...(title ? { "aria-label": title } : { "aria-hidden": true })}
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M57.75 0.0L35.78 72.82L35.78 89.77L47.39 91.02L47.39 107.34L64.97 108.6L64.97 124.29L81.61 124.29L84.12 133.71L110.17 133.71L110.17 181.1L63.4 181.1L63.4 167.92L43.94 167.92L42.69 150.66L26.99 150.66L25.74 134.02L9.1 134.02L9.1 117.39L0.31 114.88L0.31 72.82Z M232.89 0.0L291.27 73.45L291.27 115.51L283.11 116.76L281.86 133.71L266.16 133.71L264.91 150.66L248.9 150.66L248.9 167.61L209.67 129.32L210.92 124.29L226.62 124.29L226.62 108.6L243.88 107.34L243.88 91.02L255.49 89.77L255.49 71.56Z M141.56 134.02L201.51 134.02L246.08 177.65L248.9 183.93L248.9 285.62L200.25 333.96L66.54 333.96L63.72 330.19L63.72 209.04L111.11 209.04L111.11 287.51L197.11 287.51L201.51 283.74L201.51 185.19L197.11 181.42L141.56 181.42Z M792.84 134.65L833.02 134.65L895.79 291.9L952.29 152.54L976.15 134.65L1000.0 134.65L925.3 320.15L910.86 334.59L878.84 334.59L865.03 321.41Z M311.99 137.79L503.45 137.79L460.77 182.67L307.91 182.67L307.91 141.24Z M553.67 137.48L748.9 137.48L706.21 182.67L553.67 182.67Z M308.22 213.75L503.45 213.75L461.39 258.0L308.22 258.0Z M553.04 213.43L748.9 213.43L706.21 258.0L553.04 258.0Z M308.54 289.08L503.45 289.08L461.39 333.96L308.54 333.96Z M553.67 289.08L748.9 289.08L706.21 333.96L553.67 333.96Z"
      />
      <path fill={LIME} d="M1011.35 138.02L1060.28 138.02L1060.28 186.95L1011.35 186.95Z" />
    </svg>
  );
}

/** The mark on its own — the winged D and its square. */
export function Mark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 924.91 1000.0"
      height={size}
      width={Math.round(size * 0.9249 * 100) / 100}
      role={title ? "img" : "presentation"}
      {...(title ? { "aria-label": title } : { "aria-hidden": true })}
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M174.74 0.0L172.01 15.7L105.8 221.84L105.8 274.74L139.93 274.74L139.93 325.6L191.13 325.6L191.13 375.43L244.37 375.43L244.37 402.39L327.99 402.39L327.99 544.03L187.37 544.03L187.37 503.41L127.65 503.41L127.65 453.24L76.11 453.24L76.11 402.73L24.91 402.73L24.91 350.85L0.0 350.85L0.0 224.57Z M688.05 0.0L864.16 224.57L864.16 351.54L839.25 351.54L839.25 402.73L788.74 402.73L788.74 453.24L738.57 453.24L738.57 505.8L622.87 390.44L622.87 375.43L673.04 375.43L673.04 325.6L724.23 325.6L724.23 275.09L758.36 275.09L758.36 221.16Z M419.45 402.05L580.89 402.05L597.27 405.46L608.87 412.29L731.06 535.84L738.91 558.36L738.91 851.88L726.96 870.31L610.24 987.03L589.08 998.63L200.0 998.63L191.13 992.49L187.71 982.25L187.71 626.96L328.67 626.96L328.67 860.07L582.94 860.07L591.81 856.66L597.61 848.46L597.61 555.63L590.44 547.44L580.89 544.03L419.45 544.03Z"
      />
      <path fill={LIME} d="M790.1 858.36L924.57 858.36L924.57 997.61L790.1 997.61Z" />
    </svg>
  );
}
