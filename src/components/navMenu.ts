import { useMemo } from "react";
import type { Family, ModelKind } from "../data/models";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";
import type { TKey } from "../lib/i18n";
import { navPath } from "../runtime/router";
import type { NavKey } from "./TopBar";

/* ---------------------------------------------------------------------------
   What opens under a nav item, derived from the catalogue.

   The columns are the `featureCode`s a kind's families carry, and the rows are
   the families themselves — both served by `GET /catalog`. Listing the models
   in this file would put the nav back where `getFamily()` was before #55: a
   family retired in the database would go on being offered from the top bar
   until somebody deployed, and the menu is the most visible place that could
   happen.

   So the only thing written down here is which feature code earns a column and
   what that column is called, because a heading is copy rather than data. A
   code the catalogue stops using simply stops producing a column: `menuFor`
   drops empty ones instead of rendering a titled void.
   --------------------------------------------------------------------------- */

export interface MenuRow {
  family: Family;
  /** `/generate/{id}` — the same destination the model wall uses. */
  href: string;
}

export interface MenuColumn {
  code: string;
  title: TKey;
  rows: MenuRow[];
}

export interface NavMenu {
  columns: MenuColumn[];
  /** The surface itself, so the menu always offers the studio it describes. */
  footer: { label: TKey; href: string };
}

/**
 * Feature codes in the order they should read, per kind.
 *
 * Ordered by what a visitor is most likely to have come for, not
 * alphabetically: somebody opening ویدیو wants text-to-video far more often
 * than they want the edit tools, and the first column is the one that gets read.
 */
const COLUMNS: Record<ModelKind, { code: string; title: TKey }[]> = {
  image: [
    { code: "image_generate", title: "menu_image_generate" },
    { code: "image_edit", title: "menu_image_edit" },
  ],
  video: [
    { code: "video_generate", title: "menu_video_generate" },
    { code: "image_to_video", title: "menu_image_to_video" },
    { code: "video_edit", title: "menu_video_edit" },
  ],
  audio: [{ code: "speech_generate", title: "menu_speech_generate" }],
};

/** The nav items that open a menu. The rest are plain destinations. */
const KIND_OF: Partial<Record<NavKey, ModelKind>> = {
  image: "image",
  video: "video",
  audio: "audio",
};

const FOOTER: Record<ModelKind, TKey> = {
  image: "menu_all_image",
  video: "menu_all_video",
  audio: "menu_all_audio",
};

/**
 * A family belongs to a column when any of its variants files jobs under that
 * code — which is how one family appears in two columns.
 *
 * Wan is the case that matters: it generates, animates a still, and edits, so
 * it earns a row in all three of ویدیو's columns. Deduplicating it to a single
 * "primary" column would hide it from exactly the visitor who came looking for
 * that capability.
 */
function carries(family: Family, code: string): boolean {
  return family.variants.some((variant) => variant.featureCode === code);
}

/** Every menu the bar can open, keyed by nav item. */
export type NavMenus = Partial<Record<NavKey, NavMenu>>;

/**
 * Built in one pass rather than a hook per item.
 *
 * A `useNavMenu(key)` called inside the bar's `.map()` would be a hook in a
 * loop — stable today because the item list is a constant, and a bug the first
 * time somebody filters that list by tier or by locale.
 */
export function useNavMenus(): NavMenus {
  const families = useCatalogFamilies();
  return useMemo(() => {
    const menus: NavMenus = {};
    for (const [key, kind] of Object.entries(KIND_OF) as [NavKey, ModelKind][]) {
      const ofKind = families.filter((family) => family.kind === kind);
      const columns = COLUMNS[kind]
        .map(({ code, title }) => ({
          code,
          title,
          rows: ofKind
            .filter((family) => carries(family, code))
            .map((family) => ({ family, href: `/generate/${encodeURIComponent(family.id)}` })),
        }))
        .filter((column) => column.rows.length > 0);

      // A kind whose families all vanished has nothing to open. Leaving it out
      // rather than storing an empty panel keeps the item a plain link, which
      // is the correct shape for a destination with no children.
      if (columns.length > 0) menus[key] = { columns, footer: { label: FOOTER[kind], href: navPath(key) } };
    }
    return menus;
  }, [families]);
}
