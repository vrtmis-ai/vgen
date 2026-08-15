import type { FastifyInstance } from "fastify";
import type { CatalogSnapshot } from "@vgen/contracts";

export interface CustomerCatalogApplication {
  list(): Promise<CatalogSnapshot>;
}

export function registerCatalogRoute(app: FastifyInstance, catalog: CustomerCatalogApplication): void {
  app.get("/api/v1/catalog", async () => catalog.list());
}
