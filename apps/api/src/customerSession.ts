import type { CustomerIdentity, CustomerSessionUser } from "@vgen/contracts";
import type { PostgresAuthRepository } from "@vgen/db";
import type { FastifyRequest } from "fastify";
import { readSessionToken } from "./auth/cookies";
import type { CustomerSessionApplication } from "./routes/session";

/**
 * Who is making this request.
 *
 * DEEV's own auth replaced Clerk, whose SMS delivery and Google sign-in are
 * both unreliable to Iranian numbers and addresses — the entire market. Sessions
 * are rows in `sessions`, addressed by a hashed opaque token in an HttpOnly
 * cookie.
 */
export interface PrincipalResolver {
  resolve(request: FastifyRequest): Promise<CustomerSessionUser | null>;
}

/**
 * Resolves the session cookie against the database on every request.
 *
 * No JWT, and that is the point: a revoked session has to stop working
 * immediately. Suspending an account or signing out of a stolen device is
 * worthless if the credential stays valid until it expires on its own.
 */
export class SessionCookiePrincipalResolver implements PrincipalResolver {
  constructor(private readonly auth: PostgresAuthRepository) {}

  async resolve(request: FastifyRequest): Promise<CustomerSessionUser | null> {
    const token = readSessionToken(request);
    if (!token) return null;
    return this.auth.resolveSession(token);
  }
}

/** Nobody is ever authenticated. Kept for tests that need a guaranteed-anonymous API. */
export class AnonymousPrincipalResolver implements PrincipalResolver {
  async resolve(): Promise<CustomerSessionUser | null> {
    return null;
  }
}

export class CustomerSessionService implements CustomerSessionApplication {
  constructor(private readonly principals: PrincipalResolver) {}

  async getCurrent(request: FastifyRequest): Promise<CustomerIdentity> {
    const user = await this.principals.resolve(request);
    if (!user) return { status: "anonymous", host: "web" };
    return { status: "authed", host: "web", user };
  }
}
