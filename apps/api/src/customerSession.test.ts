import { describe, expect, it, vi } from "vitest";
import { AnonymousPrincipalResolver, CustomerSessionService } from "./customerSession";

describe("CustomerSessionService", () => {
  it("does not touch PostgreSQL when the request has no valid session", async () => {
    const repository = { upsertFromProfile: vi.fn() };
    const service = new CustomerSessionService({ resolve: vi.fn(async () => null) }, repository);

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "anonymous", host: "web" });
    expect(repository.upsertFromProfile).not.toHaveBeenCalled();
  });

  it("returns the internal Vgen account for an authenticated profile", async () => {
    const profile = {
      externalUserId: "user_external_123",
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
    const repository = { upsertFromProfile: vi.fn(async () => internalUser) };
    const service = new CustomerSessionService({ resolve: vi.fn(async () => profile) }, repository);

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "authed", host: "web", user: internalUser });
    expect(repository.upsertFromProfile).toHaveBeenCalledWith(profile);
  });
});

describe("AnonymousPrincipalResolver", () => {
  // The stand-in between Clerk's removal and DEEV's own auth. It must resolve to
  // nobody, so protected routes 401 instead of inventing an identity — a
  // permissive stub here is an unauthenticated wallet that looks like it works.
  it("never authenticates anyone, whatever the request carries", async () => {
    const resolver = new AnonymousPrincipalResolver();

    await expect(resolver.resolve()).resolves.toBeNull();
  });
});
