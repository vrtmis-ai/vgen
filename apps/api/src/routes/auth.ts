import {
  CheckInviteSchema,
  InviteCodeSchema,
  LoginWithPasswordSchema,
  RegisterWithPasswordSchema,
  StartPhoneVerificationSchema,
  TERMS_VERSION,
  VerifyPhoneSchema,
} from "@vgen/contracts";
import { normalizeIranianPhone } from "@vgen/core";
import { AuthError, type PostgresAuthRepository } from "@vgen/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  OAUTH_INVITE_COOKIE,
  OAUTH_STATE_COOKIE,
  clearOAuthStateCookie,
  clearSessionCookie,
  readCookie,
  readSessionToken,
  setOAuthInviteCookie,
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
  inviteCheckPerIp: AuthRateLimiter;
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
  /**
   * Absent when no SMS gateway is configured, and then phone sign-in does not
   * exist: the session says so, the screen offers email instead, and the OTP
   * routes answer 404. That is production until eNamad clears, because an
   * Iranian gateway will not send OTP templates for a site without it.
   */
  sms?: SmsSender | undefined;
}

function phoneUnavailable(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: "phone_unavailable", message: "Phone sign-in is not available yet." } });
}

const STATUS_BY_CODE: Record<AuthError["code"], number> = {
  invalid_credentials: 401,
  invite_required: 403,
  invite_invalid: 400,
  otp_invalid: 400,
  otp_expired: 400,
  otp_exhausted: 429,
  account_taken: 409,
  handle_taken: 409,
  handle_invalid: 422,
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
    if (!sms) return phoneUnavailable(reply);
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

  /**
   * Whether an invite code would admit someone now, for the invite page to ask
   * before sending a visitor on to signup.
   *
   * Not the gate. Signup checks the code again inside the transaction that
   * creates the account, so a yes here that has gone stale by then — the last
   * seat taken, the code revoked — is still refused where it matters.
   *
   * 200 either way, with one boolean. Unknown, revoked, expired, not started
   * and used up are all `false`: which one is the admin console's business.
   */
  app.post("/api/v1/auth/invite/check", { bodyLimit: 1024 }, async (request, reply) => {
    const wait = await limiters.inviteCheckPerIp.consume(request.ip);
    if (wait !== null) return tooMany(reply, wait);
    const body = CheckInviteSchema.parse(request.body);
    return reply.code(200).send({ valid: await auth.isInviteUsable(body.code) });
  });

  app.post("/api/v1/auth/otp/verify", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    if (!sms) return phoneUnavailable(reply);
    const body = VerifyPhoneSchema.parse(request.body);
    const phone = normalizeIranianPhone(body.phone);
    if (!phone) {
      return reply.code(400).send({ error: { code: "invalid_phone", message: "That is not an Iranian mobile number." } });
    }

    const wait = await limiters.otpVerifyPerPhone.consume(phone);
    if (wait !== null) return tooMany(reply, wait);

    try {
      // One call, because the code must not be spent unless the sign-in
      // succeeds. Verifying and signing in as two steps meant the 403 asking
      // for an invite code also destroyed the code needed to supply one.
      const user = await auth.signInWithPhoneCode(phone, body.code, {
        ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}),
        ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        termsVersion: TERMS_VERSION,
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
      const user = await auth.registerWithPassword(body.email, body.password, body.handle, {
        ...(body.inviteCode ? { inviteCode: body.inviteCode } : {}),
        ...(body.deviceFingerprint ? { deviceFingerprint: body.deviceFingerprint } : {}),
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        termsVersion: TERMS_VERSION,
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

    app.get(`/api/v1/auth/${provider}`, async (request, reply) => {
      // Both halves spend the login budget. Auth routes are exempt from the
      // global limiter, and the callback can create an account. A navigation
      // cannot show a JSON 429, so the refusal lands where every other failed
      // provider sign-in does.
      if ((await limiters.loginPerIp.consume(request.ip)) !== null) {
        return reply.redirect(`${options.webOrigin}/?auth=oauth_failed`, 302);
      }
      const { url, state } = client.createAuthorizationUrl();
      setOAuthStateCookie(reply, state, cookie);
      // An invitee choosing a provider instead of a phone number. The browser
      // leaves for the provider here, so the code waits in a cookie and the
      // callback hands it to the same gated signup the other routes use.
      const invite = InviteCodeSchema.safeParse((request.query as { invite?: unknown }).invite);
      setOAuthInviteCookie(reply, invite.success ? invite.data : null, cookie);
      return reply.redirect(url, 302);
    });

    app.get(`/api/v1/auth/${provider}/callback`, async (request, reply) => {
      if ((await limiters.loginPerIp.consume(request.ip)) !== null) {
        return reply.redirect(`${options.webOrigin}/?auth=oauth_failed`, 302);
      }
      const query = request.query as { code?: string; state?: string; error?: string };
      const expected = readCookie(request, OAUTH_STATE_COOKIE);
      const inviteCode = readCookie(request, OAUTH_INVITE_COOKIE);
      clearOAuthStateCookie(reply, cookie);
      setOAuthInviteCookie(reply, null, cookie);

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
          ...(inviteCode ? { inviteCode } : {}),
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          // Recorded on every path that can create an account, not only the
          // form with the words next to it. The column is written by the one
          // insert underneath all three, and only ever on creation -- signing
          // in again does not restate an agreement.
          termsVersion: TERMS_VERSION,
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
