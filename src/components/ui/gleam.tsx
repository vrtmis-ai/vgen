/**
 * The layers `.vg-gleam` turns: the ring the arc runs on, and the face the dots
 * and the sheen sit in. First child of any `.vg-gleam` element; they do not
 * display anywhere else, so it is safe to leave in a button that only wears the
 * class some of the time. See the gleam section of `components.css` for why
 * these are elements rather than pseudo-elements.
 */
export function GleamLight() {
  return (
    <>
      <i className="vg-gleam-ring" aria-hidden />
      <i className="vg-gleam-face" aria-hidden />
    </>
  );
}
