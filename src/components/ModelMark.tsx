"use client";

import { FAMILY_MARK_PATHS, VENDOR_MARK_PATHS, VENDOR_MARK_VIEWBOX } from "../data/vendorMarks";
import { VendorMark } from "./VendorMark";

/**
 * A model's mark, in two tiers: its maker's logo, then a monogram.
 *
 * The logo tier is what earns the model wall. A grid of letter-circles borrows
 * nobody's credibility — the entire point of naming Veo and Kling is that a
 * visitor already trusts Google and Kuaishou — and it cannot be the model's own
 * logo, because "Veo", "Kling" and "Nano Banana" are products of an age that
 * mostly have no published mark to use. The maker's does exist.
 *
 * Three Google families therefore show the same Google logo. That was the
 * argument against doing this at all, and it was wrong: the model's name sits
 * directly beside the mark, so nothing is ambiguous, and one real logo repeated
 * is worth more than three different letters nobody recognises.
 *
 * ## Inline, not an <img>
 *
 * The first pass wrote SVG files to `public/` and pointed an `<img>` at them.
 * That ships a logo nobody can see: an SVG loaded through `<img>` is an isolated
 * document, page CSS does not reach inside it, and the file's `currentColor`
 * resolves against its own default — black, on a near-black canvas. Half of
 * these brands are `#000000`.
 *
 * Inlining the path fixes it at the root and costs no request, which matters
 * here because the model wall draws nineteen of these at once.
 *
 * `VendorMark` remains the floor. Seven of the catalogue's thirteen vendors have
 * no icon upstream — OpenAI among them — so their families keep the monogram,
 * and that is a working state rather than a gap.
 */
export function ModelMark({ familyId, vendor, size = 16 }: { familyId?: string; vendor: string; size?: number }) {
  // The model's own mark first — Gemini's logo beside "Gemini Omni" is right in
  // a way Google's general one is not — then its maker's, then the monogram.
  const path = (familyId ? FAMILY_MARK_PATHS[familyId] : undefined) ?? VENDOR_MARK_PATHS[vendor];
  if (!path) return <VendorMark vendor={vendor} size={size} />;

  return (
    /* aria-hidden, like VendorMark: every place this appears, the model or
       vendor name is already in the adjacent text, and announcing the brand a
       second time is noise. */
    <svg
      viewBox={VENDOR_MARK_VIEWBOX}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className="shrink-0"
      style={{ width: size, height: size, color: "var(--vg-text-secondary)" }}
    >
      <path d={path} />
    </svg>
  );
}

/* `familyId` is optional because most families have no mark of their own — only
   Gemini Omni and Qwen Image do today. Callers that pass it get the better
   answer; callers that do not still get the maker's. */
