import type { ReactNode } from "react";

/**
 * The frame every screen sits in — now just a background.
 *
 * It used to carry a 480px cap and the Ambient blobs, both inherited from the
 * phone-shaped app this grew out of. Every screen now lays out its own
 * container, so the last `cap` call site rendered nothing and the prop was
 * vestigial. Ambient went with it: drifting orange blobs read as depth behind a
 * 480px card and as a smudge behind a full-width tool.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <div className="relative min-h-[100dvh] w-full bg-surface">{children}</div>;
}
