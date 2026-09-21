"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

/* Loaded only when a generation is actually running: three is ~150KB gzipped,
   and nothing before the first press needs it. `ssr: false` because the scene
   is a WebGL context — there is nothing for the server to render. */
const QuantumNebula = dynamic(() => import("./ui/quantum-nebula"), { ssr: false });

/**
 * How many of these may hold a WebGL context at once.
 *
 * Browsers keep a small pool of live contexts — Chrome drops the oldest at
 * around sixteen — and a studio can have four tiles pending plus whatever
 * کارهای من is drawing behind it. Past the cap the CSS field is what shows,
 * which is what everything showed until now, so nothing is missing; it is only
 * quieter. Four is the batch size the image dock offers.
 */
const MAX_FIELDS = 4;

let held = 0;
const waiting = new Set<() => void>();

/** Takes a slot if one is free, and hands back the release. */
function claim(retry: () => void): (() => void) | null {
  if (held >= MAX_FIELDS) {
    waiting.add(retry);
    return null;
  }
  held += 1;
  return () => {
    held -= 1;
    // Wake one waiter, so a finished tile hands its context to a pending one.
    const next: (() => void) | undefined = waiting.values().next().value;
    if (next) {
      waiting.delete(next);
      next();
    }
  };
}

function supportsWebGL(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

let cachedSupport: boolean | null = null;

/**
 * The surface a generation is drawn on while it is being made.
 *
 * Two layers, and the order matters. `.vg-gen-field` — the drifting lime this
 * has always been — stays underneath as the floor: it is what shows while the
 * scene's chunk is still downloading, on a machine with no WebGL, under
 * reduced motion, and on every tile past the context cap. The particle cloud
 * paints on top of it when all of those allow.
 *
 * So there is no state where the tile is blank, and no state where the answer
 * to "is this working" depends on a 3D scene having loaded.
 */
export function GenerationField({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!interactive) return;
    // Optional-called: a host with no `matchMedia` is not a host that wants
    // motion, and throwing here would take the tile's floor down with it.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    cachedSupport ??= supportsWebGL();
    if (!cachedSupport) return;

    let release: (() => void) | null = null;
    let live = true;
    const attempt = () => {
      if (!live) return;
      release = claim(attempt);
      if (release) setGranted(true);
    };
    attempt();

    return () => {
      live = false;
      setGranted(false);
      if (release) release();
      else waiting.delete(attempt);
    };
  }, [interactive]);

  return (
    <span className={cn("vg-gen-field", granted && "vg-gen-field--nebula", className)}>
      {/* Above the field's two drifting gradients, which keep their place as
          the floor under it: `::after` paints after ordinary children, so the
          cloud needs a layer of its own to sit on top of. */}
      {granted && <QuantumNebula className="absolute inset-0 z-10 h-full w-full" />}
    </span>
  );
}
