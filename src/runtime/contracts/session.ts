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

export const IdentityMethodSchema = z.literal("email");
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
