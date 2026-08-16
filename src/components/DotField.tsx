"use client";

import { useEffect, useRef } from "react";

/**
 * The dot field behind the sign-in screen.
 *
 * A grid of squares that wakes up from the centre outward, each cell flickering
 * between a few opacities on its own random schedule. Reversed, it goes back to
 * sleep from the edges inward, which is what a successful sign-in gets.
 *
 * WHY NOT WEBGL. The reference implementation of this effect runs a fragment
 * shader through three.js + @react-three/fiber. That is roughly 24 MB of package
 * for a decorative background, on a product whose entire pitch is that it works
 * from inside Iran on a bad connection — and the shader is not doing anything a
 * fragment shader is needed for: per-cell opacity from a hash of (cell, time),
 * gated on distance from centre. Canvas 2D draws the same thing in one pass with
 * no dependency at all.
 *
 * The cost is a few thousand fillRect calls a frame, which is nothing next to
 * shipping a WebGL renderer to every visitor. It is capped at 30fps because the
 * flicker frequency is far below that and the extra frames are invisible.
 */

const CELL = 20;
const DOT = 6;
const FPS = 30;
/** A few discrete steps read as flicker; a continuous ramp reads as noise. */
const OPACITIES = [0.15, 0.15, 0.2, 0.3, 0.3, 0.4, 0.55, 0.55, 0.7, 1];

/**
 * The share of cells painted neutral rather than accent — so the field is
 * mostly blue, with white sparks through it.
 *
 * The accent-scarcity rule in index.css ("two accent elements on one screen
 * means one of them is wrong") is about elements and filled areas. A grid of
 * 6px dots is texture, not an element and not a fill, so the rule does not
 * reach it — a deliberate reading, recorded here because the field is the
 * largest blue thing in the product and the next person will ask.
 */
const NEUTRAL_SHARE = 0.86;

/** Deterministic per-cell hash. Same shape as the shader's, so the texture matches. */
function hash(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function DotField({ reverse = false, className }: { reverse?: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Read once rather than subscribing: this component's lifetime is a few
    // seconds on one screen, and a change mid-animation is not worth the listener.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let maxDistance = 1;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.ceil(width / CELL);
      rows = Math.ceil(height / CELL);
      maxDistance = Math.hypot(columns / 2, rows / 2);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Resolved from the token rather than hard-coded, so the rebrand's one knob
    // still turns this too. Read once — it cannot change without a reload.
    const blue = getComputedStyle(document.documentElement).getPropertyValue("--vg-primary").trim() || "#00b4ff";

    const start = performance.now();
    let frame = 0;
    let previous = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - previous < 1000 / FPS) return;
      previous = now;

      // Reduced motion gets the settled state, not a frozen half-built one:
      // "in progress" is the one thing a still frame must not look like.
      const elapsed = still ? 999 : (now - start) / 1000;
      context.clearRect(0, 0, width, height);

      const centreX = columns / 2;
      const centreY = rows / 2;

      for (let column = 0; column < columns; column += 1) {
        for (let row = 0; row < rows; row += 1) {
          const seed = hash(column, row);
          const distance = Math.hypot(column - centreX, row - centreY);

          // Intro sweeps out from the middle; outro collapses in from the rim.
          const delay = reverse ? (maxDistance - distance) * 0.05 + seed * 0.2 : distance * 0.035 + seed * 0.35;
          const awake = reverse ? elapsed < delay : elapsed > delay;
          if (!awake) continue;

          const step = hash(column + Math.floor(elapsed * 2 + seed * 4), row);
          const alpha = OPACITIES[Math.floor(step * OPACITIES.length)] ?? 0.3;

          context.globalAlpha = alpha;
          context.fillStyle = seed > NEUTRAL_SHARE ? "#ffffff" : blue;
          context.fillRect(column * CELL, row * CELL, DOT, DOT);
        }
      }
      context.globalAlpha = 1;
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reverse]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
