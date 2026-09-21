import { FPS, NEUTRAL_SHARE, OPACITIES, hash } from "./DotField";

/* ---------------------------------------------------------------------------
   The sign-in field, fired by the button that starts a generation.

   The dot field behind /signin is the one moment the product performs, and the
   most recognisable thing in it. Pressing «بساز» now lights the same field
   across the button: the same hash, the same flicker steps, the same lime with
   white sparks, sweeping out from the point that was pressed over an opaque
   dark ground — so for a moment the button *is* the sign-in screen.

   It has to be seen to count, and the first version was not: a faint scatter of
   dark dots on lime for a third of a second, while the studio left for
   کارهای من the instant a submission succeeded, so the page was usually gone
   before anything drew. This one covers the whole button, and the submission
   goes when it has swept — see `useIgnition`.

   `DotField` keeps its own loop: it is the original, full-screen and endless,
   and not worth the risk of changing to share one.
   --------------------------------------------------------------------------- */

/** Cells on a 44px button. The sign-in screen's 20px would give it two rows. */
const CELL = 10;
const DOT = 3;
/** The front crosses to the farthest corner in this long, whatever the width. */
const SWEEP = 0.46;
const JITTER = 0.08;
/**
 * When the submission goes. A wall-clock timer, not the animation's last frame:
 * requestAnimationFrame stops in a background tab, and a press followed by a
 * switch to another tab would otherwise hold the generation until somebody
 * came back — the animation is decoration, and it must never be the thing a
 * paid job waits on.
 */
export const IGNITION_MS = 700;

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Light the field on a canvas from `origin` (fractions of the element), and
 * call `onDone` at `IGNITION_MS`. Returns the cleanup.
 */
export function ignite(canvas: HTMLCanvasElement, origin: { x: number; y: number }, onDone: () => void): () => void {
  const done = window.setTimeout(onDone, IGNITION_MS);
  const context = canvas.getContext("2d");
  if (!context) return () => window.clearTimeout(done);

  const root = getComputedStyle(document.documentElement);
  const lime = root.getPropertyValue("--vg-primary").trim() || "#c6f52e";
  const ground = root.getPropertyValue("--vg-canvas").trim() || "#0e1012";

  /* Measured on the first frame that has a size, not at the press: a canvas can
     report zero for a frame while the button re-renders into its busy state,
     and a grid built from zero draws nothing for its whole run. */
  let width = 0;
  let height = 0;
  let columns = 0;
  let rows = 0;
  let originX = 0;
  let originY = 0;
  let reach = 1;
  const pressed = performance.now();

  const measure = () => {
    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    columns = Math.ceil(width / CELL);
    rows = Math.ceil(height / CELL);
    originX = origin.x * columns;
    originY = origin.y * rows;
    // The farthest corner, so a press at one end still reaches the other.
    reach = Math.max(
      Math.hypot(originX, originY),
      Math.hypot(columns - originX, originY),
      Math.hypot(originX, rows - originY),
      Math.hypot(columns - originX, rows - originY),
      1,
    );
    return true;
  };

  let measured = false;
  let frame = 0;
  let previous = 0;

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    if (!measured && !(measured = measure())) return;
    if (now - previous < 1000 / FPS) return;
    previous = now;
    // From the press, so a late first frame joins the sweep where it should be
    // rather than starting it over.
    const elapsed = (now - pressed) / 1000;

    context.clearRect(0, 0, width, height);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const seed = hash(column, row);
        const distance = Math.hypot(column + 0.5 - originX, row + 0.5 - originY);
        if (elapsed < (distance / reach) * SWEEP + seed * JITTER) continue;

        const x = column * CELL;
        const y = row * CELL;
        context.globalAlpha = 1;
        context.fillStyle = ground;
        context.fillRect(x, y, CELL, CELL);

        const step = hash(column + Math.floor(elapsed * 6 + seed * 4), row);
        context.globalAlpha = OPACITIES[Math.floor(step * OPACITIES.length)] ?? 0.3;
        context.fillStyle = seed > NEUTRAL_SHARE ? "#ffffff" : lime;
        context.fillRect(x + (CELL - DOT) / 2, y + (CELL - DOT) / 2, DOT, DOT);
      }
    }
    context.globalAlpha = 1;
  };
  frame = requestAnimationFrame(draw);

  return () => {
    window.clearTimeout(done);
    cancelAnimationFrame(frame);
  };
}
