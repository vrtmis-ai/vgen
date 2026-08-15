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

export const RegisterWithPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
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
