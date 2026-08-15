import { z } from "zod";
import { SessionSchema } from "./session";

/**
 * The web tier's copy of the auth shapes.
 *
 * Mirrors `packages/contracts/src/auth.ts` rather than importing it, which is
 * the same split every other contract in this directory follows: the API parses
 * requests with its copy, the browser parses responses with this one, and the
 * browser bundle never pulls a server package in behind it.
 *
 * Deliberately looser than the server's on input. The server is the trust
 * boundary and rejects anything malformed; duplicating its exact rules here
 * would mean a validation change had to land in two places to take effect, and
 * the copy that silently disagreed would be this one.
 */

/** Accepted as typed — 0912…, +98912…, Persian digits — and normalised server-side. */
export const PhoneInputSchema = z.string().trim().min(8).max(24);

export const InviteCodeInputSchema = z.string().trim().min(3).max(64);

export const OtpCodeInputSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "A code is six digits");

/** Says nothing about whether the number already has an account. */
export const PhoneVerificationStartedSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.number().int().nonnegative(),
});

/**
 * Every credential route answers with the new session, so a caller never has to
 * follow a sign-in with a second round trip to find out who it just became.
 */
export const AuthedSessionSchema = SessionSchema;

export interface StartPhoneVerificationInput {
  phone: string;
}

export interface VerifyPhoneInput {
  phone: string;
  code: string;
  inviteCode?: string | undefined;
  deviceFingerprint?: string | undefined;
}

export interface RegisterInput {
  email: string;
  password: string;
  inviteCode?: string | undefined;
  deviceFingerprint?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type PhoneVerificationStarted = z.infer<typeof PhoneVerificationStartedSchema>;
