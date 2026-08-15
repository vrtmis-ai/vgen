import { describe, expect, it, vi } from "vitest";
import { AnonymousPrincipalResolver, CustomerSessionService, SessionCookiePrincipalResolver } from "./customerSession";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  methods: ["email"] as ["email"],
  emailNormalized: "person@example.com",
  displayName: "Vgen User",
  locale: "fa" as const,
  isTeam: false,
};

describe("CustomerSessionService", () => {
  it("reports anonymous when no principal resolves", async () => {
    const service = new CustomerSessionService({ resolve: vi.fn(async () => null) });

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "anonymous", host: "web" });
  });

  it("reports the resolved user as authed", async () => {
    const service = new CustomerSessionService({ resolve: vi.fn(async () => user) });

    await expect(service.getCurrent({} as never)).resolves.toEqual({ status: "authed", host: "web", user });
  });
});

describe("SessionCookiePrincipalResolver", () => {
  const withCookie = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as never;

  it("does not touch the database when there is no cookie", async () => {
    const auth = { resolveSession: vi.fn() };
    const resolver = new SessionCookiePrincipalResolver(auth as never);

    await expect(resolver.resolve(withCookie())).resolves.toBeNull();
    expect(auth.resolveSession).not.toHaveBeenCalled();
  });

  it("resolves the session named in the cookie, ignoring the others beside it", async () => {
    const auth = { resolveSession: vi.fn(async () => user) };
    const resolver = new SessionCookiePrincipalResolver(auth as never);

    await expect(resolver.resolve(withCookie("theme=dark; deev_session=tok-123; other=x"))).resolves.toEqual(user);
    expect(auth.resolveSession).toHaveBeenCalledWith("tok-123");
  });

  it("treats an empty cookie as no session", async () => {
    const auth = { resolveSession: vi.fn() };
    const resolver = new SessionCookiePrincipalResolver(auth as never);

    await expect(resolver.resolve(withCookie("deev_session="))).resolves.toBeNull();
    expect(auth.resolveSession).not.toHaveBeenCalled();
  });

  it("passes a rejected session through as anonymous", async () => {
    // Revoked, expired or suspended all come back null from the repository, and
    // must not become an authenticated request.
    const auth = { resolveSession: vi.fn(async () => null) };
    const resolver = new SessionCookiePrincipalResolver(auth as never);

    await expect(resolver.resolve(withCookie("deev_session=stale"))).resolves.toBeNull();
  });
});

describe("AnonymousPrincipalResolver", () => {
  it("never authenticates anyone, whatever the request carries", async () => {
    await expect(new AnonymousPrincipalResolver().resolve()).resolves.toBeNull();
  });
});
