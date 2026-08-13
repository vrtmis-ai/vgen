import { getAuth } from "@clerk/fastify";
import type { CustomerSession } from "@vgen/contracts";
import type { ClerkCustomerProfile, CustomerRepository } from "@vgen/db";
import type { FastifyRequest } from "fastify";
import type { CustomerSessionApplication } from "./routes/session";

export class InvalidClerkProfileError extends Error {
  readonly code = "invalid_clerk_profile";

  constructor() {
    super("Authenticated Clerk user has no primary email");
    this.name = "InvalidClerkProfileError";
  }
}

export interface ClerkPrincipalResolver {
  resolve(request: FastifyRequest): Promise<ClerkCustomerProfile | null>;
}

export class FastifyClerkPrincipalResolver implements ClerkPrincipalResolver {
  async resolve(request: FastifyRequest): Promise<ClerkCustomerProfile | null> {
    const auth = getAuth(request);
    if (!auth.isAuthenticated || !auth.userId) return null;

    const clerkUser = await request.clerk.users.getUser(auth.userId);
    const primaryEmail = clerkUser.emailAddresses.find((email) => email.id === clerkUser.primaryEmailAddressId)?.emailAddress;
    if (!primaryEmail) throw new InvalidClerkProfileError();
    const displayName = [clerkUser.firstName, clerkUser.lastName].filter((part): part is string => Boolean(part)).join(" ") || null;
    return {
      clerkUserId: clerkUser.id,
      emailNormalized: primaryEmail.trim().toLowerCase(),
      displayName,
      avatarUrl: clerkUser.imageUrl || null,
    };
  }
}

export class ClerkCustomerSessionService implements CustomerSessionApplication {
  constructor(
    private readonly clerk: ClerkPrincipalResolver,
    private readonly customers: CustomerRepository,
  ) {}

  async getCurrent(request: FastifyRequest): Promise<CustomerSession> {
    const profile = await this.clerk.resolve(request);
    if (!profile) return { status: "anonymous", host: "web" };
    const user = await this.customers.syncClerkUser(profile);
    return { status: "authed", host: "web", user };
  }
}
