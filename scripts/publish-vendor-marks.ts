/**
 * Generates `src/data/vendorMarks.ts` — the vendor logo paths — from the
 * `simple-icons` package.
 *
 *     pnpm marks:publish
 *
 * ## Why a generated module and not SVG files in public/
 *
 * The obvious version writes `public/brand/vendors/google.svg` and points an
 * `<img>` at it. That ships a logo nobody can see: an SVG loaded through `<img>`
 * is an isolated document, page CSS does not reach inside it, and
 * `fill="currentColor"` resolves against the file's own default — black, on a
 * near-black canvas. Half of these brands are `#000000`.
 *
 * Inlining the path solves it at the root: the mark is part of the page, takes
 * `currentColor` like any other glyph, and costs no request at all — which
 * matters more here than usual, since the model wall draws nineteen of them.
 *
 * ## The mapping is explicit on purpose
 *
 * Fuzzy-matching a vendor name against 3,453 icon titles is how you ship the
 * wrong logo. Doing exactly that during this work produced `xAI → X` (Twitter),
 * `Tongyi → TON` (a blockchain), `Recraft → R` (the R language) and
 * `Black Forest Labs → Black`. Each would have rendered as a confident, wrong
 * brand mark. Every entry below is a slug somebody checked.
 *
 * ## Vendors deliberately absent
 *
 * simple-icons has no icon for OpenAI, Black Forest Labs, Ideogram, xAI, Tongyi,
 * Topaz Labs or Recraft — its "OpenAI Gym" entry is a different product and is
 * not a substitute. Those families keep the monogram, which is a working state:
 * `VendorMark` is the floor under all of this.
 *
 * These are other companies' trademarks. Shipping them asserts they may be used
 * to indicate compatibility — a per-brand judgement, made once, recorded here.
 */
import { writeFileSync } from "node:fs";
import * as simpleIcons from "simple-icons";
import { FAMILIES } from "../src/data/models";

/**
 * Family id → slug, where the MODEL itself has a published mark.
 *
 * These beat the vendor map below, and they are the only entries that are
 * unambiguously right: the logo beside "Gemini Omni" is Gemini's own, not
 * Google's in general.
 */
const FAMILY_SLUGS: Record<string, string> = {
  "gemini-omni": "googlegemini",
  qwen: "qwen",
};

/**
 * Vendor string in `src/data/models.ts` → simple-icons slug. Checked by hand.
 *
 * A maker's logo is a *fallback*, and it is only defensible where the maker is
 * who a reader would recognise. Two mappings were removed after review, because
 * the result was a confidently wrong-looking mark:
 *
 *   Kuaishou → Kling   Kling is Kuaishou's, but nobody outside China reads the
 *                      Kuaishou mark as "Kling". It looked like the wrong logo
 *                      because, to the person looking at it, it was.
 *   Alibaba  → Wan     Wan comes from Alibaba's Tongyi lab, and the Alibaba
 *                      *Cloud* mark is a different product line again.
 *
 * Both now fall through to the monogram, which says less but says nothing false.
 * They go back the moment either model publishes its own mark.
 */
const VENDOR_SLUGS: Record<string, string> = {
  Google: "google",
  ByteDance: "bytedance",
  MiniMax: "minimax",
  ElevenLabs: "elevenlabs",
};

interface SimpleIcon {
  title: string;
  slug: string;
  path: string;
}

const icons = Object.values(simpleIcons as Record<string, unknown>).filter(
  (icon): icon is SimpleIcon => typeof icon === "object" && icon !== null && "slug" in icon && "path" in icon && "title" in icon,
);
const bySlug = new Map(icons.map((icon) => [icon.slug, icon]));

const missing: string[] = [];

function rowsFor(map: Record<string, string>, kind: string): string[] {
  const out: string[] = [];
  for (const [key, slug] of Object.entries(map)) {
    const icon = bySlug.get(slug);
    if (!icon) {
      missing.push(`${key} → ${slug}`);
      continue;
    }
    out.push(`  /** ${icon.title} — simple-icons \`${slug}\` */\n  ${JSON.stringify(key)}: ${JSON.stringify(icon.path)},`);
    console.log(`  ${kind.padEnd(7)} ${key.padEnd(14)} → ${icon.title}`);
  }
  return out;
}

/* A family id that does not exist fails silently in the worst way: the lookup
   misses, the model falls back to its maker's mark or a monogram, and the page
   looks fine. `qwen-image` was written here when the family is `qwen`, and the
   only symptom was one letter where a logo should have been. Checked here so it
   is an error rather than something to notice. */
const unknownFamilies = Object.keys(FAMILY_SLUGS).filter((id) => !FAMILIES.some((f) => f.id === id));
if (unknownFamilies.length) {
  console.error(`\nUNKNOWN FAMILY IDS — these match nothing in models.ts:\n  ${unknownFamilies.join("\n  ")}`);
  process.exit(1);
}

/* Same for vendors: a renamed vendor string would quietly drop its logo. */
const unknownVendors = Object.keys(VENDOR_SLUGS).filter((v) => !FAMILIES.some((f) => f.vendor === v));
if (unknownVendors.length) {
  console.error(`\nUNKNOWN VENDORS — these match nothing in models.ts:\n  ${unknownVendors.join("\n  ")}`);
  process.exit(1);
}

const familyRows = rowsFor(FAMILY_SLUGS, "family");
const vendorRows = rowsFor(VENDOR_SLUGS, "vendor");

if (missing.length) {
  console.error(`\nUNRESOLVED SLUGS — fix the mapping:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

const file = `// GENERATED by scripts/publish-vendor-marks.ts — do not edit by hand.
// Run \`pnpm marks:publish\` to regenerate. Both mappings, and the reasoning for
// which entries are here at all, live in that script.
//
// Single-path SVG outlines on a 24×24 viewBox, drawn with \`currentColor\` so a
// row of them reads as one system rather than as a sticker sheet — and so the
// brands whose colour is #000000 are visible on a near-black canvas.

/** Keyed by family id. The model's own mark, which beats its maker's. */
export const FAMILY_MARK_PATHS: Record<string, string> = {
${familyRows.join("\n")}
};

/** Keyed by vendor. The maker's mark, used where the model has none of its own. */
export const VENDOR_MARK_PATHS: Record<string, string> = {
${vendorRows.join("\n")}
};

/** simple-icons draws everything on this box. */
export const VENDOR_MARK_VIEWBOX = "0 0 24 24";
`;

writeFileSync("src/data/vendorMarks.ts", file);
console.log(`\n${familyRows.length} family + ${vendorRows.length} vendor marks written to src/data/vendorMarks.ts`);
