import { CustomerSessionSchema, type CustomerIdentity, type OAuthProvider } from "@vgen/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface CustomerSessionApplication {
  getCurrent(request: FastifyRequest): Promise<CustomerIdentity>;
}

/**
 * Who is signed in, and how anyone could sign in.
 *
 * The provider list is added here rather than inside the session service on
 * purpose. It comes from `createApp`, which is the one place that decides
 * whether a provider's routes get registered at all — so the list and the
 * routes cannot disagree. Threading the credentials down into the service
 * instead would create a second place that could be wrong.
 */
export function registerCustomerSessionRoute(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  authProviders: readonly OAuthProvider[] = [],
): void {
  app.get("/api/v1/session", async (request) =>
    CustomerSessionSchema.parse({ ...(await sessions.getCurrent(request)), authProviders: [...authProviders] }),
  );
}
