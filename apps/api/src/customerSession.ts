import type { CustomerSession } from "@vgen/contracts";
import type { CustomerProfile, CustomerRepository } from "@vgen/db";
import type { FastifyRequest } from "fastify";
import type { CustomerSessionApplication } from "./routes/session";

/**
 * Who is making this request.
 *
 * Clerk was removed with the Next.js migration: its SMS delivery and Google
 * sign-in are both unreliable to Iranian numbers and addresses, which is the
 * entire market. DEEV's own auth — phone OTP, email + password, Google OAuth
 * over the deev-db `users` / `auth_identities` / `sessions` tables — replaces
 * it in the own-auth phase, and plugs in here.
 *
 * The seam is unchanged, so routes did not have to move: they still ask
 * `sessions.getCurrent(request)` and branch on the result.
 */
export interface PrincipalResolver {
  resolve(request: FastifyRequest): Promise<CustomerProfile | null>;
}

/**
 * The current resolver: nobody is ever authenticated.
 *
 * Every protected route therefore answers 401 rather than guessing at an
 * identity. That is deliberate — a permissive stand-in here would be an
 * unauthenticated wallet and an unauthenticated job submission, and it would
 * look like it worked.
 */
export class AnonymousPrincipalResolver implements PrincipalResolver {
  async resolve(): Promise<CustomerProfile | null> {
    return null;
  }
}

export class CustomerSessionService implements CustomerSessionApplication {
  constructor(
    private readonly principals: PrincipalResolver,
    private readonly customers: CustomerRepository,
  ) {}

  async getCurrent(request: FastifyRequest): Promise<CustomerSession> {
    const profile = await this.principals.resolve(request);
    if (!profile) return { status: "anonymous", host: "web" };
    const user = await this.customers.upsertFromProfile(profile);
    return { status: "authed", host: "web", user };
  }
}
