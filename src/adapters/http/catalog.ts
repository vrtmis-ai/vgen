import type { AppServices } from "../../app/AppServices";
import { CatalogSnapshotSchema } from "../../app/contracts/catalog";
import type { HttpClient } from "./client";

export function createHttpCatalogService(client: HttpClient): AppServices["catalog"] {
  return {
    list(options) {
      return client.request("/catalog", { schema: CatalogSnapshotSchema, signal: options?.signal });
    },
  };
}
