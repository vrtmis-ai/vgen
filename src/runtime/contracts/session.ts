import { z } from "zod";

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
  .regex(/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/, "نام کاربری باید ۳ تا ۲۴ نویسهٔ لاتین باشد");

/**
 * How an account can be signed into.
 *
 * Was `z.literal("email")` — one value, which every producer wrote as the same
 * constant, so `methods` said "email" to somebody who had only ever used
 * Google. Widened to the kinds `auth_identities` actually holds. Old payloads
 * still parse: `["email"]` is a member of this enum.
 *
 * **The server does not populate this yet** beyond the constant. The account
 * page renders the section only when more than one arrives, so widening the
 * type on its own changes nothing on screen. See #142.
 */
export const IdentityMethodSchema = z.enum(["email", "phone", "google", "microsoft"]);
export const HostSchema = z.literal("web");
export const OAuthProviderSchema = z.enum(["google", "microsoft"]);

/**
 * The social sign-ins this server actually has.
 *
 * Mirrors `authProviders` on `CustomerSessionSchema`. Defaults to empty rather
 * than to every provider, and the direction matters: a server that does not
 * send the field yet gets no social buttons, which is the safe way to be wrong.
 * Drawing a button we cannot prove exists is the bug being fixed.
 */
const AuthProvidersSchema = z.array(OAuthProviderSchema).default([]);

/** Mirrors `phoneSignIn`. False when absent, for the same reason. */
const PhoneSignInSchema = z.boolean().default(false);

export const AccountUserSchema = z.object({
  id: z.string().min(1),
  methods: z.array(IdentityMethodSchema),
  emailNormalized: z.string().email(),
  /** The public name. NOT NULL in the database since migration 0036. */
  handle: HandleSchema,
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  /**
   * The verified number, where there is one.
   *
   * Optional because the session payload does not carry it yet: an account made
   * through the OTP route has a number the product verified and paid an SMS
   * for, and then could not show its owner. The account page prints it when it
   * arrives and omits the row when it does not. See #142.
   */
  phone: z.string().min(3).optional(),
  locale: z.string().min(2).optional(),
  isTeam: z.boolean().optional(),
});

export const SessionSchema = z
  .discriminatedUnion("status", [
    // No providers on `loading`: nothing has been asked yet, so there is
    // nothing true to say. It is not a server answer at all.
    z.object({ status: z.literal("loading"), host: HostSchema }),
    z.object({ status: z.literal("anonymous"), host: HostSchema, authProviders: AuthProvidersSchema, phoneSignIn: PhoneSignInSchema }),
    z.object({
      status: z.literal("authed"),
      host: HostSchema,
      user: AccountUserSchema,
      authProviders: AuthProvidersSchema,
      phoneSignIn: PhoneSignInSchema,
    }),
  ])
  .readonly();

export type AccountUser = z.infer<typeof AccountUserSchema>;
export type OAuthProviderName = z.infer<typeof OAuthProviderSchema>;
export type Host = z.infer<typeof HostSchema>;
export type Session = z.infer<typeof SessionSchema>;
