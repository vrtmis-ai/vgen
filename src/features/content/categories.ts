import { useMemo } from "react";
import { usePublishedContent } from "./ContentProvider";
import type { ContentCategory } from "../../runtime/contracts/content";

/**
 * The shelves the effects wall and the prompt bank file their items under.
 *
 * These were two compiled maps in `labels.ts` and are rows now (migration
 * 0034), so a screen reads them from the served document like everything else.
 * An item names its shelf by `slug`; `labelOf` turns that into the word a
 * person reads, and falls back to the slug itself — a shelf an admin
 * unpublished leaves its items on the site, and a tile with a raw `vfx` on it
 * is better than a tile with nothing.
 */
export interface Shelves {
  /** Published shelves of this scope, in the admin's order. */
  list: ContentCategory[];
  labelOf: (slug: string) => string;
  blurbOf: (slug: string) => string | undefined;
}

export function useShelves(scope: ContentCategory["scope"]): Shelves {
  const categories = usePublishedContent().categories;
  return useMemo(() => {
    const list = categories.filter((category) => category.scope === scope);
    const by = new Map(list.map((category) => [category.slug, category]));
    return {
      list,
      labelOf: (slug) => by.get(slug)?.label ?? slug,
      blurbOf: (slug) => by.get(slug)?.blurb,
    };
  }, [categories, scope]);
}
