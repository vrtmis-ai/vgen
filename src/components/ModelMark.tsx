"use client";

import { useImageFallback } from "../lib/useImageFallback";
import { VendorMark } from "./VendorMark";

/**
 * The families whose own mark we ship, and are therefore allowed to ship.
 *
 * This list is the permission, not the file. `VendorMark` exists because
 * trademarked logos are not ours to ship, so each entry here is a decision that
 * one particular brand's guidelines allow its mark to indicate compatibility —
 * a per-brand check, not a blanket one. A file appearing in `public/` is not
 * that decision; a name appearing here is.
 *
 * It is also what keeps the landing page quiet. Deriving "do we have artwork?"
 * from whether the request 404s means the marquee page of the product opens by
 * firing one failed request per model and waiting for each to fail before the
 * monogram appears — nine of them, on connections where that is not free.
 *
 * Empty is a correct state: every model falls back to its vendor monogram,
 * exactly as before this component existed.
 */
const SHIPPED_MARKS = new Set<string>([]);

/**
 * A model's own mark, with the vendor monogram as the floor.
 *
 * Why not `VendorMark` on its own: three of the models worth naming — Nano
 * Banana, Veo and Gemini Omni — are all Google, so a row of vendor marks shows
 * the same logo three times and reads as one company rather than as a catalogue.
 * A product row has to carry product marks. Until `SHIPPED_MARKS` has entries
 * that is still what the row shows; this component is the seam that fixes it one
 * brand at a time, not a fix on its own.
 */
export function ModelMark({ familyId, vendor, size = 16 }: { familyId: string; vendor: string; size?: number }) {
  const [failed, onError] = useImageFallback();

  // A file can still be removed under us — the runtime fallback stays as the
  // floor beneath the list, so a stale entry degrades instead of leaving a hole.
  if (failed || !SHIPPED_MARKS.has(familyId)) return <VendorMark vendor={vendor} size={size} />;

  return (
    <img
      src={`/brand/models/${familyId}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      onError={onError}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
