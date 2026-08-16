import { LoginWithPasswordSchema, RegisterWithPasswordSchema, StartPhoneVerificationSchema, VerifyPhoneSchema } from "@vgen/contracts";
import { normalizeIranianPhone } from "@vgen/core";
import { AuthError, type PostgresAuthRepository } from "@vgen/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  OAUTH_STATE_COOKIE,
  clearOAuthStateCookie,
  clearSessionCookie,
  readCookie,
  readSessionToken,
  setOAuthStateCookie,
  setSessionCookie,
  type CookieOptions,
} from "../auth/cookies";
import type { GoogleOAuth } from "../auth/googleOAuth";
import type { MicrosoftOAuth } from "../auth/microsoftOAuth";
import { OAuthError, statesMatch } from "../auth/oidc";
import type { SmsSender } from "../auth/sms";

/** Returns null when allowed, or the seconds to wait when not. */
export interface AuthRateLimiter {
  consume(subject: string): Promise<number | null>;
}

/**
 * One limiter per seeded rate_limit_policies row. Counters live in Redis;
 * the policy numbers live in Postgres, and server.ts is what joins them.
 */
export interface AuthRateLimiters {
  otpSendPerPhone: AuthRateLimiter;
  otpSendPerIp: AuthRateLimiter;
  otpVerifyPerPhone: AuthRateLimiter;
  loginPerAccount: AuthRateLimiter;
  loginPerIp: AuthRateLimiter;
}

export interface AuthRouteOptions {
  cookie: CookieOptions;
  limiters: AuthRateLimiters;
  google?: GoogleOAuth | undefined;
  microsoft?: MicrosoftOAuth | undefined;
  /** Where the browser lands after an OAuth round trip. */
  webOrigin: string;
}

export interface AuthDependencies {
  auth: PostgresAuthRepository;
  sms: SmsSender;
}

const STATUS_BY_CODE: Record<AuthError["code"], number> = {
  invalid_credentials: 401,
  invite_required: 403,
  invite_invalid: 400,
  otp_invalid: 400,
  otp_expired: 400,
  otp_exhausted: 429,
  account_taken: 409,
  account_suspended: 403,
};

function fail(reply: FastifyReply, error: AuthError) {
  return reply.code(STATUS_BY_CODE[error.code]).send({ error: { code: error.code, message: error.message } });
}

function tooMany(reply: FastifyReply, retryAfterSeconds: number) {
  return reply
    .code(429)
    .header("retry-after", String(retryAfterSeconds))
    .send({ error: { code: "rate_limited", message: "Too many attempts. Try again shortly." } });
}

export function registerAuthRoutes(app: FastifyInstance, dependencies: AuthDependencies, options: AuthRouteOptions): void {
  const { auth, sms } = dependencies;
  const { cookie, limiters } = options;

  const startSession = async (reply: FastifyReply, request: FastifyRequest, userId: string) => {
    const { token, expiresAt } = await auth.createSession(userId, request.ip, request.headers["user-agent"]);
    setSessionCookie(reply, token, expiresAt, cookie);
  };

  // ------------------------------------------------------------------ phone

  app.post("/api/v1/auth/otp/start", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = StartPhoneVerificationSchema.parse(request.body);
    const phone = normalizeIranianPhone(body.phone);
    if (!phone) {
      return reply.code(400).send({ error: { code: "invalid_phone", message: "That is not an Iranian mobile number." } });
    }

    // Per number and per address. The first stops one number being pestered
    // and, more to the point, stops an attacker burning our SMS budget; the
    // second stops one machine walking the number space.
    const perPhone = await limiters.otpSendPerPhone.consume(phone);
    if (perPhone !== null) return tooMany(reply, perPhone);
    const perIp = await limiters.otpSendPerIp.consume(request.ip);
    if (perIp !== null) return tooMany(reply, perIp);

    const { code, expiresAt } = await auth.startPhoneVerification(phone, request.ip);
    try {
      await sms.sendVerificationCode(phone, code);
    } catch (error) {
      request.log.error({ err: error }, "sms gateway failed");
      return reply.code(502).send({ error: { code: "sms_unavailable", message: "The code could not be sent. Try again." } });
    }

    // Says only that a code was sent, never whether the number has an account —
    // otherwise this endpoint is a membership oracle for any phone number.
    return reply.code(202).send({ sent: true, expiresAt: expiresAt.getTime() });
  });

  app.post("/api/v1/auth/otp/verify", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = VerifyPhoneSchema.parse(request.body);
    const phone = normalizeIranianPhone(body.phone);
    if (!phone) {
      return reply.code(400).send({ error: { code: "invalid_phone", message: "That is not an Iranian mobile number." } });
    }

    const wait = await limiters.otpVerifyPerPhone.consume(phone);
    if (wait !== null) return tooMany(reply, wait);

    try {
      await auth.verifyPhoneCode(phone, body.code);
      const user = await auth.signInWithPhone(phone, {
        ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}),
        ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      await auth.recordLoginAttempt({ identifier: phone, userId: user.id, method: "otp", succeeded: true, ip: request.ip });
      await startSession(reply, request, user.id);
      return reply.code(200).send({ status: "authed", host: "web", user });
    } catch (error) {
      if (error instanceof AuthError) {
        await auth.recordLoginAttempt({
          identifier: phone,
          method: "otp",
          succeeded: false,
          failureReason: error.code,
          ip: request.ip,
        });
        return fail(reply, error);
      }
      throw error;
    }
  });

  // --------------------------------------------------------- email/password

  app.post("/api/v1/auth/register", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = RegisterWithPasswordSchema.parse(request.body);
    const wait = await limiters.loginPerIp.consume(request.ip);
    if (wait !== null) return tooMany(reply, wait);

    try {
      const user = await auth.registerWithPassword(body.email, body.password, {
        ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}),
        ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      await startSession(reply, request, user.id);
      return reply.code(201).send({ status: "authed", host: "web", user });
    } catch (error) {
      if (error instanceof AuthError) return fail(reply, error);
      throw error;
    }
  });

  app.post("/api/v1/auth/login", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = LoginWithPasswordSchema.parse(request.body);

    const perIp = await limiters.loginPerIp.consume(request.ip);
    if (perIp !== null) return tooMany(reply, perIp);
    const perAccount = await limiters.loginPerAccount.consume(body.email);
    if (perAccount !== null) return tooMany(reply, perAccount);

    try {
      const user = await auth.loginWithPassword(body.email, body.password);
      await auth.recordLoginAttempt({
        identifier: body.email,
        userId: user.id,
        method: "password",
        succeeded: true,
        ip: request.ip,
      });
      await startSession(reply, request, user.id);
      return reply.code(200).send({ status: "authed", host: "web", user });
    } catch (error) {
      if (error instanceof AuthError) {
        await auth.recordLoginAttempt({
          identifier: body.email,
          method: "password",
          succeeded: false,
          failureReason: error.code,
          ip: request.ip,
        });
        return fail(reply, error);
      }
      throw error;
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = readSessionToken(request);
    if (token) await auth.revokeSession(token);
    clearSessionCookie(reply, cookie);
    // Unconditionally 204: whether the caller held a valid session is not
    // something logging out should reveal.
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ OAuth

  /**
   * Google and Microsoft are the same two routes with a different client, so
   * they are registered from one place rather than copied. Each provider stays
   * independently optional — credentials for one do not imply the other, and a
   * provider that is not configured has no endpoint at all rather than one that
   * fails once the user has already committed to it.
   *
   * `provider` is also the `auth_identities.provider` value. The column is
   * plain text with a UNIQUE (provider, provider_uid), so a new provider needs
   * no migration; it just has to keep using the same string forever, because
   * changing it would orphan every identity already linked under the old one.
   */
  for (const [provider, client] of [
    ["google", options.google],
    ["microsoft", options.microsoft],
  ] as const) {
    if (!client) continue;

    app.get(`/api/v1/auth/${provider}`, async (_request, reply) => {
      const { url, state } = client.createAuthorizationUrl();
      setOAuthStateCookie(reply, state, cookie);
      return reply.redirect(url, 302);
    });

    app.get(`/api/v1/auth/${provider}/callback`, async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };
      const expected = readCookie(request, OAUTH_STATE_COOKIE);
      clearOAuthStateCookie(reply, cookie);

      // The state check comes first, before the code is worth anything: without
      // it an attacker completes a login into their own account inside someone
      // else's browser, and every generation that follows is theirs.
      if (query.error || !query.code || !statesMatch(query.state, expected ?? undefined)) {
        return reply.redirect(`${options.webOrigin}/?auth=failed`, 302);
      }

      try {
        const profile = await client.exchangeCode(query.code);
        // profile.email is null unless the provider proved it. Passing it on
        // is what decides between linking to the account that already owns the
        // address and creating a new one, so it must not be filled in from
        // somewhere else to make the flow tidier.
        const user = await auth.signInWithOAuth(provider, profile.subject, profile.email, profile.displayName, {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
        await auth.recordLoginAttempt({
          identifier: profile.email ?? profile.subject,
          userId: user.id,
          method: "oauth",
          succeeded: true,
          ip: request.ip,
        });
        await startSession(reply, request, user.id);
        return reply.redirect(options.webOrigin, 302);
      } catch (error) {
        if (error instanceof AuthError || error instanceof OAuthError) {
          request.log.warn({ err: error, provider }, "oauth sign-in failed");
          // An invite-gated signup arriving through a provider fails here, so
          // the reason travels in the URL for the landing page to explain.
          const reason = error instanceof AuthError ? error.code : "oauth_failed";
          return reply.redirect(`${options.webOrigin}/?auth=${reason}`, 302);
        }
        throw error;
      }
    });
  }
}
