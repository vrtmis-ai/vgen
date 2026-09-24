import {
  CustomerSessionSchema,
  UpdateProfileSchema,
  type CustomerIdentity,
  type CustomerSessionUser,
  type OAuthProvider,
} from "@vgen/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface CustomerSessionApplication {
  getCurrent(request: FastifyRequest): Promise<CustomerIdentity>;
  /** Null when nobody is signed in, so the route answers 401 rather than guessing. */
  currentUserId(request: FastifyRequest): Promise<string | null>;
  updateProfile(userId: string, changes: { handle?: string | undefined; displayName?: string | undefined }): Promise<CustomerSessionUser>;
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
  phoneSignIn = false,
): void {
  app.get("/api/v1/session", async (request) =>
    CustomerSessionSchema.parse({ ...(await sessions.getCurrent(request)), authProviders: [...authProviders], phoneSignIn }),
  );

  /**
   * Changing your own name.
   *
   * There was no route by which anybody could edit anything about themselves —
   * every field on `users` was written once at sign-up and never again, and
   * /profile was a page of read-only rows. The subject is always the session's
   * own user; there is no parameter for anyone else's, which is what keeps this
   * off the admin surface.
   */
  app.patch("/api/v1/me", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const userId = await sessions.currentUserId(request);
    if (!userId) return reply.code(401).send({ error: { code: "unauthorised", message: "Sign in first." } });

    const changes = UpdateProfileSchema.parse(request.body);
    return reply.send({ user: await sessions.updateProfile(userId, changes) });
  });
}
