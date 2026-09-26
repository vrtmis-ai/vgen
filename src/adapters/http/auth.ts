import { z } from "zod";
import type { AppServices } from "../../runtime/AppServices";
import {
  AuthedSessionSchema,
  ForgotPasswordSentSchema,
  InviteCheckResultSchema,
  PasswordResetSchema,
  PhoneVerificationStartedSchema,
  ResetTokenStateSchema,
} from "../../runtime/contracts/auth";
import { AccountUserSchema } from "../../runtime/contracts/session";
import type { HttpClient } from "./client";

/** `undefined` is what readJson() yields for the empty 204 body logout returns. */
const VoidSchema = z.undefined();

/**
 * The credential routes.
 *
 * Nothing here reads or stores a token: the session is an HttpOnly cookie the
 * browser sends on its own, and `createHttpClient` already sets
 * `credentials: "include"`. That is also why logout has no body and no
 * response worth parsing — the answer is a cleared cookie.
 *
 * Failures arrive as `ApiError` with the server's code (`invite_required`,
 * `invalid_credentials`, `otp_exhausted`, …). Callers should branch on `.code`,
 * never on the message.
 */
export function createHttpAuthService(client: HttpClient, baseUrl: string): AppServices["auth"] {
  return {
    async startPhoneVerification(input, options) {
      return client.request("/auth/otp/start", {
        method: "POST",
        body: { phone: input.phone },
        schema: PhoneVerificationStartedSchema,
        signal: options?.signal,
      });
    },

    async verifyPhone(input, options) {
      return client.request("/auth/otp/verify", {
        method: "POST",
        // Omitted rather than sent as null: the server's schemas are .strict()
        // and treat an explicit undefined-shaped key as a validation failure.
        body: {
          phone: input.phone,
          code: input.code,
          ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
          ...(input.deviceFingerprint ? { deviceFingerprint: input.deviceFingerprint } : {}),
        },
        schema: AuthedSessionSchema,
        signal: options?.signal,
      });
    },

    async register(input, options) {
      return client.request("/auth/register", {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          handle: input.handle,
          ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
          ...(input.deviceFingerprint ? { deviceFingerprint: input.deviceFingerprint } : {}),
        },
        schema: AuthedSessionSchema,
        signal: options?.signal,
      });
    },

    async login(input, options) {
      return client.request("/auth/login", {
        method: "POST",
        body: { email: input.email, password: input.password },
        schema: AuthedSessionSchema,
        signal: options?.signal,
      });
    },

    /* The route this posts to is not merged yet — see the issue. It is written
       here rather than gated behind a flag because the two adapters have to
       expose the same surface, which `adapters/parity.test.ts` enforces: a
       method demo mode has and production does not is a screen that works
       where it was built and not where it ships. The ordering is the
       safeguard instead — `early_access` does not go on in production before
       the route does. */
    async waitlistCount(options?: { signal?: AbortSignal }) {
      const { count } = await client.request("/auth/waitlist/count", {
        schema: z.object({ count: z.number().int().nonnegative() }),
        signal: options?.signal,
      });
      return count;
    },

    async joinWaitlist(contact: string, options?: { signal?: AbortSignal }) {
      await client.request("/auth/waitlist", {
        method: "POST",
        body: { contact },
        schema: z.object({ status: z.literal("listed") }),
        signal: options?.signal,
      });
    },

    async requestPasswordReset(email: string, options?: { signal?: AbortSignal }) {
      // The token is mailed, never returned — there is nothing here to read
      // but the fact that a mail went out.
      await client.request("/auth/password/forgot", {
        method: "POST",
        body: { email },
        schema: ForgotPasswordSentSchema,
        signal: options?.signal,
      });
    },

    async checkPasswordReset(token: string, options?: { signal?: AbortSignal }) {
      const { status } = await client.request("/auth/password/reset/check", {
        method: "POST",
        body: { token },
        schema: ResetTokenStateSchema,
        signal: options?.signal,
      });
      return status;
    },

    async resetPassword(token: string, password: string, options?: { signal?: AbortSignal }) {
      await client.request("/auth/password/reset", {
        method: "POST",
        body: { token, password },
        schema: PasswordResetSchema,
        signal: options?.signal,
      });
    },

    async checkInvite(code, options) {
      const result = await client.request("/auth/invite/check", {
        method: "POST",
        body: { code },
        schema: InviteCheckResultSchema,
        signal: options?.signal,
      });
      return result;
    },

    async startProviderSignIn(provider, inviteCode) {
      /* The one call here that is not a request.
         `client.request` would be wrong twice over: the browser has to *arrive*
         at the provider carrying the HttpOnly state cookie the API sets on this
         redirect, and an XHR neither follows the cross-origin hop nor keeps that
         cookie. So this leaves the page, and nothing after it runs.

         `assign` rather than `replace`: the back button should bring someone who
         changed their mind back to the sign-in screen, not to whatever preceded
         it. */
      const invite = inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : "";
      globalThis.location.assign(`${baseUrl.replace(/\/+$/, "")}/auth/${provider}${invite}`);
    },

    async logout(options) {
      // No body on purpose: the client only sets Content-Type when there is
      // one, and Fastify rejects an empty body that declares itself JSON before
      // the route ever runs.
      await client.request("/auth/logout", { method: "POST", schema: VoidSchema, signal: options?.signal });
    },

    async updateProfile(edit, options) {
      // Only what moved. The server's schema is .strict() and reads an
      // explicitly-undefined key as a validation failure rather than as "leave
      // this alone", which is what an omitted one means.
      const result = await client.request("/me", {
        method: "PATCH",
        body: {
          ...(edit.handle === undefined ? {} : { handle: edit.handle }),
          ...(edit.displayName === undefined ? {} : { displayName: edit.displayName }),
        },
        schema: z.object({ user: AccountUserSchema }),
        signal: options?.signal,
      });
      return result.user;
    },
  };
}
