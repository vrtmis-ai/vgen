import { CustomerSessionSchema, type CustomerSession } from "@vgen/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface CustomerSessionApplication {
  getCurrent(request: FastifyRequest): Promise<CustomerSession>;
}

export function registerCustomerSessionRoute(app: FastifyInstance, sessions: CustomerSessionApplication): void {
  app.get("/api/v1/session", async (request) => CustomerSessionSchema.parse(await sessions.getCurrent(request)));
}
