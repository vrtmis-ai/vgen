/**
 * The real Google and Microsoft marks, for the two buttons on the sign-in
 * screen.
 *
 * Everywhere else in the product a brand is drawn by `VendorMark`, a coloured
 * monogram, and that is a deliberate choice rather than a placeholder: a model
 * vendor's logo is their trademark and not ours to ship. Identity providers are
 * the exception both companies make themselves — Google and Microsoft each
 * publish their sign-in mark *and require it*, because a button that says "sign
 * in with Google" beside a home-made blue "G" is exactly what a phishing page
 * looks like. Recognition is the security property here.
 *
 * Not in `src/data/vendorMarks.ts`: that file is generated, and
 * `scripts/publish-vendor-marks.ts` hard-fails on a vendor that is not in
 * `src/data/models.ts` — neither of these sells us a model. It is also drawn in
 * `currentColor` on purpose, so a row of model marks reads as one system;
 * these two are the opposite case and must keep their own colours.
 *
 * Geometry and colour are one list rather than two parallel ones, so no future
 * edit can reorder the paths and silently paint Google's mark wrong.
 */
interface Mark {
  viewBox: string;
  parts: { d: string; fill: string }[];
}

const MARKS: Record<string, Mark> = {
  google: {
    viewBox: "0 0 24 24",
    parts: [
      {
        d: "M23 12.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124 1.014-.797 2.542-2.294 3.569l-.021.136 3.332 2.53.23.022C21.779 18.417 23 15.593 23 12.245z",
        fill: "#4285F4",
      },
      {
        d: "M12.225 23c3.03 0 5.574-.978 7.433-2.665l-3.542-2.688c-.948.648-2.22 1.1-3.891 1.1a6.745 6.745 0 01-6.386-4.572l-.132.011-3.465 2.628-.045.124C4.043 20.531 7.835 23 12.225 23z",
        fill: "#34A853",
      },
      {
        d: "M5.84 14.175A6.65 6.65 0 015.463 12c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831 10.831 0 001 12c0 1.772.436 3.447 1.197 4.938l3.642-2.763z",
        fill: "#FBBC05",
      },
      {
        d: "M12.225 5.253c2.108 0 3.529.892 4.34 1.638l3.167-3.031C17.787 2.088 15.255 1 12.225 1 7.834 1 4.043 3.469 2.197 7.062l3.63 2.763a6.77 6.77 0 016.398-4.572z",
        fill: "#EA4335",
      },
    ],
  },
  // Four squares with a gap, at Microsoft's published proportions. Drawn as
  // paths rather than <rect> for no reason other than that one shape type is
  // easier to read than two.
  microsoft: {
    viewBox: "0 0 24 24",
    parts: [
      { d: "M2 2h9.5v9.5H2z", fill: "#F25022" },
      { d: "M12.5 2H22v9.5h-9.5z", fill: "#7FBA00" },
      { d: "M2 12.5h9.5V22H2z", fill: "#00A4EF" },
      { d: "M12.5 12.5H22V22h-9.5z", fill: "#FFB900" },
    ],
  },
};

/**
 * `aria-hidden`, like every other mark in the product: the button it sits in
 * already says "ادامه با گوگل", and announcing the brand twice is noise to
 * anyone listening rather than looking.
 */
export function AuthProviderMark({ provider, size = 18 }: { provider: string; size?: number }) {
  const mark = MARKS[provider];
  if (!mark) return null;

  return (
    <svg
      viewBox={mark.viewBox}
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className="shrink-0"
      style={{ width: size, height: size }}
    >
      {mark.parts.map((part) => (
        <path key={part.fill} d={part.d} fill={part.fill} />
      ))}
    </svg>
  );
}
