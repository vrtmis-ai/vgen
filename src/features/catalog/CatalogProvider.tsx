import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CatalogSnapshot } from "../../runtime/contracts/catalog";
import type { Family } from "../../data/models";

type CatalogFamilies = CatalogSnapshot["families"];

const CatalogContext = createContext<Family[] | null>(null);

/**
 * The HTTP payload has already passed CatalogSnapshotSchema. Zod represents
 * optional keys as `T | undefined`, while the hand-authored runtime interfaces
 * use exact optional properties. At this validated boundary both describe the
 * same JSON shape, so normalize the type once instead of casting in screens.
 */
export function toRuntimeFamilies(families: CatalogFamilies): Family[] {
  return families as Family[];
}

export function CatalogProvider({ families, children }: { families: CatalogFamilies; children: ReactNode }) {
  return <CatalogContext.Provider value={toRuntimeFamilies(families)}>{children}</CatalogContext.Provider>;
}

export function useCatalogFamilies(): Family[] {
  const families = useContext(CatalogContext);
  if (!families) throw new Error("Published catalog is not available. Wrap the screen in CatalogProvider.");
  return families;
}

/**
 * One family, by id, from the served catalogue.
 *
 * This replaces `getFamily()` in `data/models.ts`, which searched the
 * compiled-in `FAMILIES` constant. Nothing was broken by that — the committed
 * snapshot and the API serve the same document — but a family retired in the
 * database went on rendering, because the screen was reading a copy that a
 * deploy had frozen. Undefined here means the catalogue genuinely does not have
 * it, which is the answer a screen needs in order to stop drawing it.
 */
export function useFamily(id: string | null | undefined): Family | undefined {
  const families = useCatalogFamilies();
  return useMemo(() => (id ? families.find((f) => f.id === id) : undefined), [families, id]);
}

/**
 * The lookup as a function, for a screen that resolves several ids in a list
 * and cannot call a hook per row.
 */
export function useFamilyLookup(): (id: string | null | undefined) => Family | undefined {
  const families = useCatalogFamilies();
  return useMemo(() => (id) => (id ? families.find((f) => f.id === id) : undefined), [families]);
}
