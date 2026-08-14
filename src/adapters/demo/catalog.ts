import type { AppServices } from "../../runtime/AppServices";
import { FAMILIES } from "../../data/models";

export function createDemoCatalogService(now: () => number): AppServices["catalog"] {
  return {
    async list() {
      return { version: "demo-catalog-v1", publishedAt: now(), families: FAMILIES };
    },
  };
}
