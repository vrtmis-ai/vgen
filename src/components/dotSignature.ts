import { hash } from "./DotField";

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

/**
 * A 4px cell, so a 44px button is eleven rows rather than four.
 *
 * It was ten, with a 3px dot inside it — seven tenths of every cell empty, which
 * read as a sparse scatter rather than as a field. The block now fills the cell
 * but for a 1px gutter, and at this size the button carries around 900 of them.
 */
const CELL = 4;
/** The front crosses to the farthest corner in this fraction of the run. */
const SWEEP = 0.58;
/** And the lime starts coming back at this one, from the middle outward. */
const RETURN = 0.52;
/** How ragged the front is. Bayer, so it frays in a grid rather than smoothly. */
const DITHER = 0.09;
/** The field advances in steps this often. Below the frame rate, on purpose. */
const STEPS_PER_SECOND = 14;
/**
 * Hard steps, darkest to brightest. Opacity used to carry this in ten smooth
 * levels, which is the one thing that cannot look 8-bit: every neighbouring
 * pair has to be a jump, not a ramp.
 */
const RAMP = ["#243406", "#5c7a12", "#8fb31f", "#c6f52e", "#ffffff"] as const;
/** A 4x4 Bayer matrix, the oldest way to make an edge break up in squares. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;
/**
 * When the submission goes. A wall-clock timer, not the animation's last frame:
 * requestAnimationFrame stops in a background tab, and a press followed by a
 * switch to another tab would otherwise hold the generation until somebody
 * came back — the animation is decoration, and it must never be the thing a
 * paid job waits on.
 */
export const IGNITION_MS = 1100;

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
  const seconds = IGNITION_MS / 1000;

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
  /* Redraw only when the quantised step changes. The field advances fourteen
     times a second by design, and repainting nine hundred cells on every one of
     sixty frames to produce an identical picture is most of the cost for none
     of the effect. */
  let lastStep = -1;

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    if (!measured && !(measured = measure())) return;

    const elapsed = (now - pressed) / 1000;
    const step = Math.floor(elapsed * STEPS_PER_SECOND);
    if (step === lastStep) return;
    lastStep = step;
    const t = step / STEPS_PER_SECOND;

    /* Normalised against the last step rather than against IGNITION_MS: the
       quantised clock lands short of the wall clock, and the difference left a
       band of cells still lit in the corners when the layer unmounted. */
    const back = (t - RETURN * seconds) / Math.max(seconds - RETURN * seconds - 1 / STEPS_PER_SECOND, 1e-3);
    const latest = SWEEP * seconds + DITHER / 2;

    context.clearRect(0, 0, width, height);
    const lit: { x: number; y: number; level: number }[] = [];

    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const seed = hash(column, row);
        const distance = Math.hypot(column + 0.5 - originX, row + 0.5 - originY);
        const arrives = (distance / reach) * SWEEP * seconds + (BAYER[row & 3]![column & 3]! / 16 - 0.5) * DITHER;
        const age = t - arrives;
        if (age < 0) continue;
        // The lime returns in the order it left, so the button is whole again
        // exactly as the job is sent rather than snapping back when it is.
        if (back > 0 && back >= arrives / latest) continue;

        // The front itself: white at the very edge, settling to the ramp behind.
        const front = Math.max(0, 1 - age / (0.13 * seconds));
        const flicker = hash(column + Math.floor(t * STEPS_PER_SECOND * 1.6 + seed * 5), row);
        let level = front > 0.6 ? 4 : front > 0.25 ? 3 : flicker > 0.88 ? 3 : flicker > 0.6 ? 2 : flicker > 0.3 ? 1 : 0;
        if (seed > 0.93 && flicker > 0.5) level = 4;

        const x = column * CELL;
        const y = row * CELL;
        context.fillStyle = ground;
        context.fillRect(x, y, CELL, CELL);
        context.fillStyle = RAMP[level]!;
        context.fillRect(x, y, CELL - 1, CELL - 1);
        if (level >= 3) lit.push({ x, y, level });
      }
    }

    /* The bloom is a second pass, additively, over blocks that are already
       drawn — so the pixel keeps its hard edge and only the light around it is
       soft. Blurring the block itself would round off the one thing this is
       for. Only the top two levels carry it: `shadowBlur` is the expensive
       call here, and a halo on a dim cell is not visible anyway. */
    context.globalCompositeOperation = "lighter";
    for (const { x, y, level } of lit) {
      const white = level === 4;
      context.shadowColor = white ? "#ffffff" : lime;
      context.shadowBlur = white ? 14 : 9;
      context.globalAlpha = white ? 0.6 : 0.4;
      context.fillStyle = white ? "#ffffff" : lime;
      context.fillRect(x, y, CELL - 1, CELL - 1);
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  };
  frame = requestAnimationFrame(draw);

  return () => {
    window.clearTimeout(done);
    cancelAnimationFrame(frame);
  };
}
