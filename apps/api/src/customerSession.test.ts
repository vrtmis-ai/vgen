import { describe, expect, it, vi } from "vitest";
import { ClerkCustomerSessionService } from "./customerSession";

describe("ClerkCustomerSessionService", () => {
  it("does not touch PostgreSQL when the request has no valid Clerk session", async () => {
    const repository = { syncClerkUser: vi.fn() };
    const service = new ClerkCustomerSessionService({ resolve: vi.fn(async () => null) }, repository);

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "anonymous", host: "web" });
    expect(repository.syncClerkUser).not.toHaveBeenCalled();
  });

  it("returns the internal Vgen account for an authenticated Clerk profile", async () => {
    const profile = {
      clerkUserId: "user_clerk_123",
      emailNormalized: "person@example.com",
      displayName: "Vgen User",
      avatarUrl: null,
    };
    const internalUser = {
      id: "00000000-0000-4000-8000-000000000001",
      methods: ["email"] as ["email"],
      emailNormalized: "person@example.com",
      displayName: "Vgen User",
      locale: "fa" as const,
      isTeam: false,
    };
    const repository = { syncClerkUser: vi.fn(async () => internalUser) };
    const service = new ClerkCustomerSessionService({ resolve: vi.fn(async () => profile) }, repository);

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "authed", host: "web", user: internalUser });
    expect(repository.syncClerkUser).toHaveBeenCalledWith(profile);
  });
});
