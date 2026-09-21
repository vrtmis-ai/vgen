import type { ReactNode } from "react";

/**
 * The frame every screen sits in — and the ground they all stand on.
 *
 * It used to carry a 480px cap and drifting blobs, both inherited from the
 * phone-shaped app this grew out of; every screen lays out its own container
 * now, so both went.
 *
 * What it carries instead is the stage: the dot grid and the drifting light
 * the studio canvases had to themselves, plus the grain over everything. One
 * ground for the whole product rather than one product with a lit workbench
 * and a flat everything-else. See `.vg-stage` in index.css — including why it
 * paints no background of its own.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <div className="vg-stage vg-grain relative min-h-[100dvh] w-full">{children}</div>;
}
