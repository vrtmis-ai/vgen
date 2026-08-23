import type { FastifyInstance } from "fastify";
import type { CatalogSnapshot } from "@vgen/contracts";
import { publicJson } from "../publicJson";

export interface CustomerCatalogApplication {
  list(): Promise<CatalogSnapshot>;
}

export function registerCatalogRoute(app: FastifyInstance, catalog: CustomerCatalogApplication): void {
  const send = publicJson<CatalogSnapshot>();
  app.get("/api/v1/catalog", async (_request, reply) => send(reply, await catalog.list()));
}
