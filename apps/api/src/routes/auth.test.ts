import { AuthError } from "@vgen/db";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAuthRoutes, type AuthRateLimiters } from "./auth";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  methods: ["email"] as ["email"],
  emailNormalized: "person@example.com",
  handle: "person",
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
  inviteCheckPerIp: allow(),
  waitlistJoinPerIp: allow(),
  passwordResetPerIp: allow(),
  passwordResetPerAccount: allow(),
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
    isInviteUsable: vi.fn(async (code: string) => code === "LIVE-CODE" || code === "BOUND-CODE"),
    inviteBinding: vi.fn(async (code: string) => (code === "BOUND-CODE" ? { kind: "email" as const, value: "waited@example.com" } : null)),
    recordLoginAttempt: vi.fn(async () => undefined),
    startPasswordReset: vi.fn(
      async (
        email: string,
        _context?: unknown,
      ): Promise<
        | { kind: "sent"; userId: string; token: string }
        | { kind: "no_account" }
        | { kind: "other_method"; userId: string; method: "oauth" | "phone" }
      > => {
        if (email === "nobody@example.com") return { kind: "no_account" };
        if (email === "google@example.com") return { kind: "other_method", userId: "user-google", method: "oauth" };
        return { kind: "sent", userId: "user-1", token: "a-real-reset-token" };
      },
    ),
    checkPasswordReset: vi.fn(async (token: string) => (token === "a-real-reset-token" ? "usable" : "unknown")),
    completePasswordReset: vi.fn(async (_token: string, _password: string) => undefined),
  };
}

/** Parameters spelled out so assertions can read the message that was sent. */
const mailerDouble = () => ({
  send: vi.fn(async (_message: { to: string; subject: string; text: string; html: string }) => undefined),
  close: vi.fn(),
});

/** Only the two methods the auth routes reach for. */
function accessDouble() {
  return {
    joinWaitlist: vi.fn(async (_channel: "email" | "phone", _contact: string): Promise<"listed" | "has_account"> => "listed"),
    waitlistCount: vi.fn(async () => 7),
  };
}

function build(
  overrides: {
    auth?: ReturnType<typeof authDouble>;
    access?: ReturnType<typeof accessDouble>;
    limiters?: AuthRateLimiters;
    google?: Parameters<typeof registerAuthRoutes>[2]["google"];
    microsoft?: Parameters<typeof registerAuthRoutes>[2]["microsoft"];
    withoutSms?: boolean;
    mailer?: ReturnType<typeof mailerDouble>;
    withoutMailer?: boolean;
  } = {},
) {
  const auth = overrides.auth ?? authDouble();
  const access = overrides.access ?? accessDouble();
  const mailer = overrides.mailer ?? mailerDouble();
  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAuthRoutes(
    app,
    {
      auth: auth as never,
      access: access as never,
      sms: overrides.withoutSms ? undefined : { sendVerificationCode: vi.fn(async () => undefined) },
      mailer: overrides.withoutMailer ? undefined : mailer,
    },
    {
      cookie: { secure: true },
      limiters: overrides.limiters ?? openLimiters(),
      webOrigin: "https://deev.test",
      ...(overrides.google ? { google: overrides.google } : {}),
      ...(overrides.microsoft ? { microsoft: overrides.microsoft } : {}),
    },
  );
  return { app, auth, access, mailer };
}

const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const raw = response.headers["set-cookie"];
  return Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
};

describe("requesting a code", () => {
  it("does not exist without an SMS gateway", async () => {
    const { app, auth } = build({ withoutSms: true });

    const start = await app.inject({ method: "POST", url: "/api/v1/auth/otp/start", payload: { phone: "09121234567" } });
    const verify = await app.inject({ method: "POST", url: "/api/v1/auth/otp/verify", payload: { phone: "09121234567", code: "123456" } });

    expect([start.statusCode, verify.statusCode]).toEqual([404, 404]);
    expect(start.json().error.code).toBe("phone_unavailable");
    expect(auth.startPhoneVerification).not.toHaveBeenCalled();
    expect(auth.signInWithPhoneCode).not.toHaveBeenCalled();
    await app.close();
  });

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
        access: accessDouble() as never,
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

describe("checking an invite code from the invite page", () => {
  it("answers one boolean, the same shape for every refusal", async () => {
    const { app, auth } = build();

    const live = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "LIVE-CODE" } });
    const dead = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "made-up" } });

    expect([live.statusCode, live.json()]).toEqual([200, { valid: true }]);
    expect([dead.statusCode, dead.json()]).toEqual([200, { valid: false }]);
    expect(auth.isInviteUsable).toHaveBeenCalledTimes(2);
    await app.close();
  });

  /* A waitlist code belongs to one address, and the sign-up form fills its
     locked field from this. Returning the address to whoever presents the code
     is deliberate — it was mailed there, it is single-use, and the route is
     rate limited — but only ever for a code that still works. */
  it("names who a waitlist code was issued to", async () => {
    const { app } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "BOUND-CODE" } });

    expect([response.statusCode, response.json()]).toEqual([200, { valid: true, contact: { kind: "email", value: "waited@example.com" } }]);
    await app.close();
  });

  it("says nothing about a campaign code, which admits whoever holds it", async () => {
    const { app } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "LIVE-CODE" } });

    expect(response.json()).toEqual({ valid: true });
    await app.close();
  });

  it("does not name anybody for a code that no longer works", async () => {
    const { app, auth } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "made-up" } });

    // Otherwise this becomes a way to ask "was this address ever invited?",
    // which is a different question from the one the route answers.
    expect(response.json()).toEqual({ valid: false });
    expect(auth.inviteBinding).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a malformed body before touching the database", async () => {
    const { app, auth } = build();

    const tooShort = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "x" } });
    const extra = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "LIVE-CODE", admin: true } });

    expect([tooShort.statusCode, extra.statusCode]).toEqual([400, 400]);
    expect(auth.isInviteUsable).not.toHaveBeenCalled();
    await app.close();
  });

  it("stops answering once an IP has asked too often", async () => {
    const limiters = openLimiters();
    limiters.inviteCheckPerIp = { consume: vi.fn(async () => 600) };
    const { app, auth } = build({ limiters });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/invite/check", payload: { code: "LIVE-CODE" } });

    expect(response.statusCode).toBe(429);
    expect(auth.isInviteUsable).not.toHaveBeenCalled();
    await app.close();
  });
});

/**
 * The queue for the people the gate turns away.
 *
 * The screen for this shipped in #122 and posted into a 404 for three days,
 * so the tests that matter most are the ones about what it *says*: the same
 * answer whether or not the address was already listed, because the route is
 * open and unauthenticated and a different answer would make it a way to ask
 * who is already waiting.
 *
 * Whether the address already has an *account* is the one thing it does say
 * differently, by the owner's decision — the alternative left somebody with an
 * account waiting for a mail that was never coming.
 */
describe("joining the waitlist", () => {
  it("takes an address and says it is listed", async () => {
    const { app, access } = build();

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: "someone@example.com" } });

    expect([response.statusCode, response.json()]).toEqual([200, { status: "listed" }]);
    expect(access.joinWaitlist).toHaveBeenCalledWith("email", "someone@example.com");
    await app.close();
  });

  it("sends somebody who already has an account to sign in instead of into the queue", async () => {
    const { app, access } = build();
    access.joinWaitlist.mockResolvedValue("has_account");

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: "member@example.com" } });

    // A distinct code, not the generic failure: the page turns this into
    // "you already have an account, sign in" rather than "something broke".
    expect([response.statusCode, response.json().error.code]).toEqual([409, "account_exists"]);
    await app.close();
  });

  it("folds a mobile to the shape every other phone column uses", async () => {
    const { app, access } = build();

    for (const typed of ["09121234567", "+989121234567", "0912 123 4567"]) {
      await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: typed } });
    }

    // Three spellings, one number: the unique index sees the same string each
    // time, so they are one place in the queue rather than three.
    expect(access.joinWaitlist.mock.calls).toEqual([
      ["phone", "09121234567"],
      ["phone", "09121234567"],
      ["phone", "09121234567"],
    ]);
    await app.close();
  });

  it("answers a repeat exactly as it answered the first time", async () => {
    const { app } = build();
    const payload = { contact: "twice@example.com" };

    const first = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload });
    const again = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload });

    // Byte for byte. Anything that differed would answer "does this address
    // already have an account here", which is not a question this route is
    // allowed to answer.
    expect([again.statusCode, again.json()]).toEqual([first.statusCode, first.json()]);
    await app.close();
  });

  it("refuses what is neither an address nor a number, without writing", async () => {
    const { app, access } = build();

    const junk = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: "hello" } });
    const extra = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: "a@b.co", admin: true } });

    expect(junk.statusCode).toBe(422);
    expect(junk.json().error.code).toBe("validation_failed");
    expect(extra.statusCode).toBe(400);
    expect(access.joinWaitlist).not.toHaveBeenCalled();
    await app.close();
  });

  it("stops answering once an IP has asked too often", async () => {
    const limiters = openLimiters();
    limiters.waitlistJoinPerIp = { consume: vi.fn(async () => 600) };
    const { app, access } = build({ limiters });

    const response = await app.inject({ method: "POST", url: "/api/v1/auth/waitlist", payload: { contact: "flood@example.com" } });

    expect(response.statusCode).toBe(429);
    expect(access.joinWaitlist).not.toHaveBeenCalled();
    await app.close();
  });

  it("hands the holding page a raw count to draw", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/waitlist/count" });

    // Raw. The screen adds its own floor before showing a number, so adding
    // one here would apply it twice.
    expect([response.statusCode, response.json()]).toEqual([200, { count: 7 }]);
    await app.close();
  });
});

describe("an invite carried through a provider", () => {
  const google = {
    createAuthorizationUrl: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "state-abc" }),
    exchangeCode: vi.fn(async () => ({ subject: "google-1", email: "person@example.com", emailVerified: true, displayName: "P" })),
  };

  it("sends a rate-limited provider sign-in back to the site instead of to the provider", async () => {
    const limiters = openLimiters();
    limiters.loginPerIp = { consume: vi.fn(async () => 30) };
    const { app } = build({ google: google as never, limiters });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google?invite=EARLY-1" });

    expect(response.headers.location).toBe("https://deev.test/?auth=oauth_failed");
    expect(cookieOf(response)).not.toContain("deev_oauth_invite=EARLY-1");
    await app.close();
  });

  it("keeps the code in a cookie while the browser is at the provider", async () => {
    const { app } = build({ google: google as never });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google?invite=EARLY-1" });

    expect(cookieOf(response)).toContain("deev_oauth_invite=EARLY-1");
    await app.close();
  });

  it("clears any earlier code when this attempt carries none", async () => {
    const { app } = build({ google: google as never });

    const response = await app.inject({ method: "GET", url: "/api/v1/auth/google" });

    expect(cookieOf(response)).toContain("deev_oauth_invite=;");
    await app.close();
  });

  it("hands the code to the gated signup on the way back, then drops it", async () => {
    const { app, auth } = build({ google: google as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/google/callback?code=abc&state=state-abc",
      headers: { cookie: "deev_oauth_state=state-abc; deev_oauth_invite=EARLY-1" },
    });

    expect(auth.signInWithOAuth.mock.calls[0]?.[4]).toMatchObject({ inviteCode: "EARLY-1" });
    expect(cookieOf(response)).toContain("deev_oauth_invite=;");
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

/**
 * The way back in.
 *
 * Two things this must never do: return the token in the response, which
 * would hand the link to whoever made the request, and sign anybody in, which
 * would turn a mail link into a session.
 */
describe("asking for a password reset", () => {
  it("mails a link and says only that it sent one", async () => {
    const { app, auth, mailer } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "forgot@example.com" },
    });

    expect([response.statusCode, response.json()]).toEqual([200, { status: "sent" }]);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(auth.startPasswordReset).toHaveBeenCalledWith("forgot@example.com", expect.objectContaining({ ip: expect.any(String) }));

    // The token is mailed, never returned. The body must not carry it, and
    // neither must any header.
    expect(JSON.stringify(response.json())).not.toContain("a-real-reset-token");
    expect(cookieOf(response)).not.toContain("a-real-reset-token");
  });

  it("puts the link in the mail, pointed at the reset page", async () => {
    const { app, mailer } = build();

    await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "forgot@example.com" } });

    const sent = mailer.send.mock.calls[0]![0];
    expect(sent.to).toBe("forgot@example.com");
    expect(sent.html).toContain("https://deev.test/reset?token=a-real-reset-token");
    expect(sent.text).toContain("https://deev.test/reset?token=a-real-reset-token");
  });

  it("says plainly when no account uses the address", async () => {
    const { app, mailer } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "nobody@example.com" },
    });

    // The owner's decision: the waitlist already reveals registration, and
    // silence here leaves a typo'd address waiting for a mail forever.
    expect([response.statusCode, response.json().error.code]).toEqual([404, "no_account"]);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("mails an account with no password how it actually signs in", async () => {
    const { app, mailer } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "google@example.com" },
    });

    // Still `sent`, because something really was sent — but it carries no
    // reset link, because there is no password to reset.
    expect([response.statusCode, response.json()]).toEqual([200, { status: "sent" }]);
    const sent = mailer.send.mock.calls[0]![0];
    expect(sent.html).not.toContain("/reset?token=");
    expect(sent.html).toContain("https://deev.test/signin");
  });

  it("does not pretend to send when there is no mail account", async () => {
    const { app, auth } = build({ withoutMailer: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "forgot@example.com" },
    });

    // Reporting a success nobody received is the worse failure: they wait,
    // and nothing ever arrives.
    expect([response.statusCode, response.json().error.code]).toEqual([503, "mail_unavailable"]);
    expect(auth.startPasswordReset).not.toHaveBeenCalled();
  });

  it("stops a spray before it reaches the mailer", async () => {
    const limiters = openLimiters();
    limiters.passwordResetPerIp = { consume: vi.fn(async () => 300) };
    const { app, auth, mailer } = build({ limiters });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "forgot@example.com" },
    });

    expect([response.statusCode, response.json().error.code]).toEqual([429, "rate_limited"]);
    expect(response.headers["retry-after"]).toBe("300");
    expect(auth.startPasswordReset).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("spends the per-account allowance only on an address that exists", async () => {
    const limiters = openLimiters();
    const { app } = build({ limiters });

    await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "nobody@example.com" } });
    // Otherwise a stranger could exhaust somebody's own recovery quota by
    // guessing at addresses.
    expect(limiters.passwordResetPerAccount.consume).not.toHaveBeenCalled();

    await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "forgot@example.com" } });
    expect(limiters.passwordResetPerAccount.consume).toHaveBeenCalledWith("user-1");
  });

  it("refuses a body that is not an address", async () => {
    const { app, auth } = build();

    const junk = await app.inject({ method: "POST", url: "/api/v1/auth/password/forgot", payload: { email: "hello" } });

    expect(junk.statusCode).toBe(400);
    expect(junk.json().error.code).toBe("validation_failed");
    expect(auth.startPasswordReset).not.toHaveBeenCalled();
  });
});

describe("spending a password reset link", () => {
  it("reports what a link is worth before anybody types into it", async () => {
    const { app } = build();

    const good = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/check",
      payload: { token: "a-real-reset-token" },
    });
    const bad = await app.inject({ method: "POST", url: "/api/v1/auth/password/reset/check", payload: { token: "made-up" } });

    expect(good.json()).toEqual({ status: "usable" });
    expect(bad.json()).toEqual({ status: "unknown" });
  });

  it("sets the password and signs nobody in", async () => {
    const { app, auth } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token: "a-real-reset-token", password: "a-brand-new-password" },
    });

    expect([response.statusCode, response.json()]).toEqual([200, { status: "reset" }]);
    expect(auth.completePasswordReset).toHaveBeenCalledWith("a-real-reset-token", "a-brand-new-password");
    /* No session cookie. A reset that signed you in would mean anybody who
       can read the mailbox is inside without knowing the password. */
    expect(cookieOf(response)).not.toContain("session");
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["reset_invalid", "That link is not valid"],
    ["reset_expired", "That link has expired"],
    ["reset_used", "That link has already been used"],
  ])("passes %s through as a 400 with its own code", async (code, message) => {
    const auth = authDouble();
    auth.completePasswordReset = vi.fn(async () => {
      throw new AuthError(code as "reset_invalid", message);
    });
    const { app } = build({ auth });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token: "whatever", password: "a-brand-new-password" },
    });

    // Distinct codes, because the page says something different for each.
    expect([response.statusCode, response.json().error.code]).toEqual([400, code]);
  });

  it("refuses a password under the floor before touching the database", async () => {
    const { app, auth } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token: "a-real-reset-token", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(auth.completePasswordReset).not.toHaveBeenCalled();
  });
});
