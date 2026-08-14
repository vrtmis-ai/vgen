import { createContext, useContext, type ReactNode } from "react";
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
