/**
 * Which version of the terms a signup was agreed against.
 *
 * A date rather than a number, because that is what the page itself is dated
 * with and a reader comparing the two should not have to translate. Bump it
 * when the published terms change in substance; every account created after
 * that carries the new string, and the old ones keep saying what they actually
 * agreed to.
 *
 * Held here rather than in the API so the page that shows the terms and the
 * column that records them cannot name different documents.
 */
export const TERMS_VERSION = "2026-09-09";

import { z } from "zod";

/**
 * An invite code as typed by a person.
 *
 * Trimmed but not lowercased: the column is citext, so case does not matter for
 * matching, and preserving what was typed keeps it recognisable in an error
 * message. Length caps are here so a hostile client cannot make the database
 * compare a megabyte.
 */
export const InviteCodeSchema = z.string().trim().min(3).max(64);

export const CheckInviteSchema = z.object({ code: InviteCodeSchema }).strict();
export const InviteCheckResultSchema = z.object({ valid: z.boolean() });

/**
 * Accepted as typed, in any of the forms an Iranian number is written in —
 * 0912…, +98912…, 98912…, and Persian digits. Normalisation to E.164 happens
 * server-side, because two spellings of one number must not become two
 * accounts with two free trials.
 */
export const PhoneSchema = z.string().trim().min(8).max(24);

export const OtpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "A code is six digits");

/**
 * Opaque device signal used only to spot one device farming many accounts. It
 * is a hash produced by the client and is never treated as an identity.
 */
export const DeviceFingerprintSchema = z.string().trim().min(8).max(128);

export const StartPhoneVerificationSchema = z
  .object({
    phone: PhoneSchema,
  })
  .strict();

export const VerifyPhoneSchema = z
  .object({
    phone: PhoneSchema,
    code: OtpCodeSchema,
    inviteCode: InviteCodeSchema.optional(),
    deviceFingerprint: DeviceFingerprintSchema.optional(),
  })
  .strict();

/**
 * A username: the public name for an account, unique across the site.
 *
 * Latin only — `a–z 0–9 . _`, 3–24, starting and ending on a letter or digit.
 * The rule and the reason both live in `@vgen/core`'s `normalizeHandle`, which
 * the server calls on everything that reaches it; this schema is the shape
 * check that lets a form say no without a round trip.
 */
export const HandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/, "not a username");

/**
 * Changing your own name. Both fields optional, because the form sends only
 * what moved — and an empty body is a no-op rather than an error, since
 * "save" on an unchanged form is not a mistake worth a 400.
 */
export const UpdateProfileSchema = z
  .object({
    handle: HandleSchema.optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const RegisterWithPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    /**
     * Required here and nowhere else. The password form is the only sign-up
     * path this deployment actually runs — the session says
     * `authProviders: []` and `phoneSignIn: false` — so asking here covers
     * everybody real, and OAuth and the phone code, which have no form to ask
     * on, mint one instead.
     */
    handle: HandleSchema,
    // Only a floor. Composition rules push people toward `Password1!`, and the
    // real check lives in the hashing layer so every entry point shares it.
    password: z.string().min(10).max(512),
    inviteCode: InviteCodeSchema.optional(),
    deviceFingerprint: DeviceFingerprintSchema.optional(),
  })
  .strict();

export const LoginWithPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(512),
  })
  .strict();

/** Deliberately says nothing about whether the number is known. */
export const PhoneVerificationStartedSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.number().int().nonnegative(),
});

export type StartPhoneVerification = z.infer<typeof StartPhoneVerificationSchema>;
export type VerifyPhone = z.infer<typeof VerifyPhoneSchema>;
export type RegisterWithPassword = z.infer<typeof RegisterWithPasswordSchema>;
export type LoginWithPassword = z.infer<typeof LoginWithPasswordSchema>;
