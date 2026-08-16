"use client";

import { FAMILY_MARKS, VENDOR_MARKS } from "../data/vendorMarks";
import { VendorMark } from "./VendorMark";

/**
 * A model's mark, in four tiers: a bitmap stencil, the model's own vector logo,
 * its maker's, then a monogram.
 *
 * The logo is what earns the model wall. A grid of letter-circles borrows
 * nobody's credibility, and the entire point of naming Veo and Kling is that a
 * visitor already trusts Google and Kuaishou.
 *
 * The model's own mark beats its maker's wherever one exists, and that ordering
 * is not cosmetic: Kuaishou's logo beside "Kling" was reported as simply the
 * wrong logo, and it was — nobody outside China reads that mark as Kling. Where
 * only the maker's exists it still earns its place, so three Google families
 * share the Google logo with their own names beside them.
 *
 * ## Inline, not an <img>
 *
 * An earlier pass wrote SVG files to `public/` and pointed an `<img>` at them.
 * That ships a logo nobody can see: an SVG loaded through `<img>` is an isolated
 * document, page CSS does not reach inside it, and the file's `currentColor`
 * resolves against its own default — black, on a near-black canvas.
 *
 * Inlining fixes it at the root and costs no request, which matters because the
 * model wall draws nineteen of these at once.
 *
 * `VendorMark` remains the floor. Only Z-Image still reaches it.
 */

/**
 * Marks that exist only as a bitmap, drawn as a stencil rather than an image.
 *
 * Wan is the sole entry and likely to stay that way: it is the one model in the
 * catalogue with no vector logo published anywhere — not in @lobehub/icons, not
 * in svgl, not in its own GitHub repo, and not on wan.video, which serves a PNG
 * from a CDN.
 *
 * `mask-image` rather than `<img>`, and that is the whole trick. An `<img>` is
 * an isolated document that ignores page CSS, so a bitmap logo cannot be tinted
 * and would sit in the row at its own brand colour while the other seventeen
 * take `currentColor`. As a mask, only the alpha channel is used and the element
 * paints itself through it — so this weighs and colours exactly like a vector
 * mark. `scripts/make-mark-mask.ts` is what turns the supplied PNG into that
 * alpha channel.
 */
const RASTER_MASKS: Record<string, string> = {
  wan: "/brand/marks/wan.png",
};

export function ModelMark({ familyId, vendor, size = 16 }: { familyId?: string; vendor: string; size?: number }) {
  const mask = familyId ? RASTER_MASKS[familyId] : undefined;
  if (mask) {
    return (
      <span
        aria-hidden
        className="shrink-0"
        style={{
          width: size,
          height: size,
          background: "var(--vg-text-secondary)",
          maskImage: `url(${mask})`,
          WebkitMaskImage: `url(${mask})`,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }

  // The model's own mark first — Kling's logo beside "Kling" is right in a way
  // Kuaishou's is not — then its maker's, then the monogram.
  const mark = (familyId ? FAMILY_MARKS[familyId] : undefined) ?? VENDOR_MARKS[vendor];
  if (!mark) return <VendorMark vendor={vendor} size={size} />;

  return (
    /* aria-hidden, like VendorMark: every place this appears, the model or
       vendor name is already in the adjacent text, and announcing the brand a
       second time is noise.

       Every path, not the first. Google's mark is four and ByteDance's is four;
       rendering one of them draws a quarter of the logo, which looks like a
       glitch rather than like a brand. */
    <svg
      viewBox={mark.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className="shrink-0"
      style={{ width: size, height: size, color: "var(--vg-text-secondary)" }}
    >
      {mark.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/* `familyId` is optional because most families have no mark of their own — only
   Gemini Omni and Qwen Image do today. Callers that pass it get the better
   answer; callers that do not still get the maker's. */
