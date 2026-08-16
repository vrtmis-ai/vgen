import { AuthError } from "@vgen/db";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAuthRoutes, type AuthRateLimiters } from "./auth";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  methods: ["email"] as ["email"],
  emailNormalized: "person@example.com",
  locale: "fa" as const,
  isTeam: false,
};

const allow = () => ({ consume: vi.fn(async () => null) });
const openLimiters = (): AuthRateLimiters => ({
  otpSendPerPhone: allow(),
  otpSendPerIp: allow(),
  otpVerifyPerPhone: allow(),
  loginPerAccount: allow(),
  loginPerIp: allow(),
});

function authDouble() {
  return {
    // Parameters spelled out so assertions can read the recorded call arguments.
    startPhoneVerification: vi.fn(async (_phone: string, _ip?: string) => ({ code: "123456", expiresAt: new Date(1_000) })),
    verifyPhoneCode: vi.fn(async () => undefined),
    signInWithPhone: vi.fn(async () => user),
    // Verifying and signing in are one call now, so that a refused signup does
    // not spend the code it was refused for.
    signInWithPhoneCode: vi.fn(async (_phone: string, _code: string, _context?: unknown) => user),
    registerWithPassword: vi.fn(async () => user),
    loginWithPassword: vi.fn(async () => user),
    signInWithOAuth: vi.fn(
      async (_provider: string, _providerUid: string, _email: string | null, _displayName: string | null, _context?: unknown) => user,
    ),
    createSession: vi.fn(async (_userId: string, _ip?: string, _userAgent?: string) => ({
      token: "tok-abc",
      expiresAt: new Date(Date.now() + 86_400_000),
    })),
    revokeSession: vi.fn(async () => undefined),
    recordLoginAttempt: vi.fn(async () => undefined),
  };
}

function build(
  overrides: {
    auth?: ReturnType<typeof authDouble>;
    limiters?: AuthRateLimiters;
    google?: Parameters<typeof registerAuthRoutes>[2]["google"];
    microsoft?: Parameters<typeof registerAuthRoutes>[2]["microsoft"];
  } = {},
) {
  const auth = overrides.auth ?? authDouble();
  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAuthRoutes(
    app,
    { auth: auth as never, sms: { sendVerificationCode: vi.fn(async () => undefined) } },
    {
      cookie: { secure: true },
      limiters: overrides.limiters ?? openLimiters(),
      webOrigin: "https://deev.test",
      ...(overrides.google ? { google: overrides.google } : {}),
      ...(overrides.microsoft ? { microsoft: overrides.microsoft } : {}),
    },
  );
  return { app, auth };
}

const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const raw = response.headers["set-cookie"];
  return Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
};

describe("requesting a code", () => {
  it("normalises every way an Iranian number is written before using it", async () => {
    const { app, auth } = build();

    for (const phone of ["09121234567", "+989121234567", "۰۹۱۲۱۲۳۴۵۶۷"]) {
      await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone } });
    }

    // Three spellings, one number — otherwise each would be a separate account
    // with a separate free trial.
    for (const call of auth.startPhoneVerification.mock.calls) expect(call[0]).toBe("+989121234567");
    await app.close();
  });

  it("rejects a number that is not an Iranian mobile", async () => {
    const { app, auth } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone: "02112345678" } });

    expect(response.statusCode).toBe(400);
    expect(auth.startPhoneVerification).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers the same whether or not the number has an account", async () => {
    // Otherwise this endpoint tells anyone which numbers are registered.
    const { app } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone: "09121234567" } });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ sent: true, expiresAt: 1_000 });
    await app.close();
  });

  it("stops sending once the per-number budget is spent", async () => {
    const limiters = openLimiters();
    limiters.otpSendPerPhone = { consume: vi.fn(async () => 42) };
    const { app, auth } = build({ limiters });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone: "09121234567" } });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("42");
    // The SMS is never sent, which is the point: the budget protects spend.
    expect(auth.startPhoneVerification).not.toHaveBeenCalled();
    await app.close();
  });

  it("reports a gateway failure as a gateway failure", async () => {
    const auth = authDouble();
    const app: FastifyInstance = Fastify({ logger: false });
    registerErrorHandling(app);
    registerAuthRoutes(
      app,
      {
        auth: auth as never,
        sms: {
          sendVerificationCode: vi.fn(async () => {
            throw new Error("gateway down");
          }),
        },
      },
      { cookie: { secure: true }, limiters: openLimiters(), webOrigin: "https://deev.test" },
    );

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone: "09121234567" } });

    expect(response.statusCode).toBe(502);
    await app.close();
  });
});

describe("verifying a code", () => {
  const payload = { phone: "09121234567", code: "123456" };

  it("issues an HttpOnly session cookie on success", async () => {
    const { app } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "authed", user: { id: user.id } });
    const cookie = cookieOf(response);
    expect(cookie).toContain("deev_session=tok-abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    await app.close();
  });

  it("passes the invite code through to signup", async () => {
    const { app, auth } = build();

    await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload: { ...payload, inviteCode: "apple-deev" } });

    expect(auth.signInWithPhoneCode).toHaveBeenCalledWith("+989121234567", "123456", expect.objectContaining({ inviteCode: "apple-deev" }));
    await app.close();
  });

  it("refuses a signup with no invite while early access is on", async () => {
    const auth = authDouble();
    auth.signInWithPhoneCode = vi.fn(async () => {
      throw new AuthError("invite_required", "DEEV is in early access");
    });
    const { app } = build({ auth });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("invite_required");
    expect(cookieOf(response)).not.toContain("deev_session=tok");
    await app.close();
  });

  it("records a failed attempt without issuing a session", async () => {
    const auth = authDouble();
    auth.signInWithPhoneCode = vi.fn(async () => {
      throw new AuthError("otp_invalid", "wrong");
    });
    const { app } = build({ auth });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload });

    expect(response.statusCode).toBe(400);
    expect(auth.createSession).not.toHaveBeenCalled();
    expect(auth.recordLoginAttempt).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false }));
    await app.close();
  });

  it("answers 429 when the code budget is exhausted", async () => {
    const auth = authDouble();
    auth.signInWithPhoneCode = vi.fn(async () => {
      throw new AuthError("otp_exhausted", "too many");
    });
    const { app } = build({ auth });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload });

    expect(response.statusCode).toBe(429);
    await app.close();
  });

  it("rejects a malformed code before touching the database", async () => {
    const { app, auth } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/otp/verify",
      payload: { phone: "09121234567", code: "abc" },
    });

    expect(response.statusCode).toBe(400);
    expect(auth.verifyPhoneCode).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("email and password", () => {
  it("answers 401 for bad credentials and records the attempt", async () => {
    const auth = authDouble();
    auth.loginWithPassword = vi.fn(async () => {
      throw new AuthError("invalid_credentials", "nope");
    });
    const { app } = build({ auth });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "person@example.com", password: "a wrong password" },
    });

    expect(response.statusCode).toBe(401);
    expect(auth.recordLoginAttempt).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false, method: "password" }));
    await app.close();
  });

  it("limits by address as well as by account", async () => {
    const limiters = openLimiters();
    limiters.loginPerAccount = { consume: vi.fn(async () => 30) };
    const { app, auth } = build({ limiters });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "person@example.com", password: "some password" },
    });

    expect(response.statusCode).toBe(429);
    expect(auth.loginWithPassword).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a password too short to be worth storing", async () => {
    const { app, auth } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "person@example.com", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(auth.registerWithPassword).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("logging out", () => {
  it("revokes the session and clears the cookie", async () => {
    const { app, auth } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: "deev_session=tok-abc" },
    });

    expect(response.statusCode).toBe(204);
    expect(auth.revokeSession).toHaveBeenCalledWith("tok-abc");
    expect(cookieOf(response)).toContain("deev_session=;");
    await app.close();
  });

  it("succeeds even with no session, without saying so", async () => {
    const { app, auth } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });

    expect(response.statusCode).toBe(204);
    expect(auth.revokeSession).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("Google sign-in", () => {
  const google = {
    createAuthorizationUrl: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "state-abc" }),
    exchangeCode: vi.fn(async () => ({ subject: "google-1", email: "person@example.com", emailVerified: true, displayName: "P" })),
  };

  beforeEach(() => google.exchangeCode.mockClear());

  it("is not registered at all when Google is not configured", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("sends the browser to Google with a state cookie", async () => {
    const { app } = build({ google: google as never });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("accounts.google.com");
    expect(cookieOf(response)).toContain("deev_oauth_state=state-abc");
    await app.close();
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    // Without this check an attacker completes a sign-in to their own Google
    // account inside someone else's browser.
    const { app, auth } = build({ google: google as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/google/callback?code=abc&state=forged",
      headers: { cookie: "deev_oauth_state=state-abc" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://deev.test/?auth=failed");
    expect(google.exchangeCode).not.toHaveBeenCalled();
    expect(auth.createSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a callback with no state cookie at all", async () => {
    const { app } = build({ google: google as never });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google/callback?code=abc&state=state-abc" });

    expect(response.headers.location).toBe("https://deev.test/?auth=failed");
    await app.close();
  });

  it("signs in and clears the state cookie when the state matches", async () => {
    const { app, auth } = build({ google: google as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/google/callback?code=abc&state=state-abc",
      headers: { cookie: "deev_oauth_state=state-abc" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://deev.test");
    expect(auth.createSession.mock.calls[0]?.[0]).toBe(user.id);
    const cookie = cookieOf(response);
    expect(cookie).toContain("deev_oauth_state=;");
    expect(cookie).toContain("deev_session=tok-abc");
    await app.close();
  });
});

describe("Microsoft sign-in", () => {
  const microsoft = {
    createAuthorizationUrl: () => ({
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1",
      state: "state-ms",
    }),
    exchangeCode: vi.fn(async () => ({
      subject: "microsoft-1",
      email: "person@example.com",
      emailVerified: true,
      displayName: "P",
    })),
  };

  beforeEach(() => microsoft.exchangeCode.mockClear());

  it("is not registered at all when Microsoft is not configured", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/microsoft" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("sends the browser to Microsoft with a state cookie", async () => {
    const { app } = build({ microsoft: microsoft as never });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/microsoft" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("login.microsoftonline.com");
    expect(cookieOf(response)).toContain("deev_oauth_state=state-ms");
    await app.close();
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    const { app, auth } = build({ microsoft: microsoft as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/microsoft/callback?code=abc&state=forged",
      headers: { cookie: "deev_oauth_state=state-ms" },
    });

    expect(response.headers.location).toBe("https://deev.test/?auth=failed");
    expect(microsoft.exchangeCode).not.toHaveBeenCalled();
    expect(auth.createSession).not.toHaveBeenCalled();
    await app.close();
  });

  // The identity is filed under the provider that issued it. Getting this wrong
  // would collide two people's subject claims in one UNIQUE (provider,
  // provider_uid) row and hand one of them the other's account.
  it("files the identity under microsoft, not the other provider", async () => {
    const { app, auth } = build({ microsoft: microsoft as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/microsoft/callback?code=abc&state=state-ms",
      headers: { cookie: "deev_oauth_state=state-ms" },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://deev.test");
    expect(auth.signInWithOAuth.mock.calls[0]?.slice(0, 2)).toEqual(["microsoft", "microsoft-1"]);
    expect(cookieOf(response)).toContain("deev_session=tok-abc");
    await app.close();
  });

  // Each provider is configured on its own, so one being present must not drag
  // the other's endpoints into existence.
  it("does not register Google just because Microsoft is configured", async () => {
    const { app } = build({ microsoft: microsoft as never });

    expect((await app.inject({ method: "GET", url: "/api/v1/auth/google" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/microsoft" })).statusCode).toBe(302);
    await app.close();
  });

  // An address the provider would not vouch for arrives as null, and has to
  // stay null all the way to the repository — that argument is what decides
  // between linking to an existing account and creating a new one.
  it("passes an unverified address through as null", async () => {
    const unverified = {
      createAuthorizationUrl: () => ({ url: "https://login.microsoftonline.com/common", state: "state-ms" }),
      exchangeCode: vi.fn(async () => ({ subject: "microsoft-2", email: null, emailVerified: false, displayName: "P" })),
    };
    const { app, auth } = build({ microsoft: unverified as never });

    await app.inject({
      method: "GET",
      url: "/api/v1/auth/microsoft/callback?code=abc&state=state-ms",
      headers: { cookie: "deev_oauth_state=state-ms" },
    });

    expect(auth.signInWithOAuth.mock.calls[0]?.[2]).toBeNull();
    await app.close();
  });
});
