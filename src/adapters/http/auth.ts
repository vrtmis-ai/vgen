import { z } from "zod";
import type { AppServices } from "../../runtime/AppServices";
import { AuthedSessionSchema, PhoneVerificationStartedSchema } from "../../runtime/contracts/auth";
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
export function createHttpAuthService(client: HttpClient): AppServices["auth"] {
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

    async logout(options) {
      // No body on purpose: the client only sets Content-Type when there is
      // one, and Fastify rejects an empty body that declares itself JSON before
      // the route ever runs.
      await client.request("/auth/logout", { method: "POST", schema: VoidSchema, signal: options?.signal });
    },
  };
}
