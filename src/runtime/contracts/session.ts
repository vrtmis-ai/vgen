import { z } from "zod";

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

export const AccountUserSchema = z.object({
  id: z.string().min(1),
  methods: z.array(IdentityMethodSchema),
  emailNormalized: z.string().email(),
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
    z.object({ status: z.literal("anonymous"), host: HostSchema, authProviders: AuthProvidersSchema }),
    z.object({
      status: z.literal("authed"),
      host: HostSchema,
      user: AccountUserSchema,
      authProviders: AuthProvidersSchema,
    }),
  ])
  .readonly();

export type AccountUser = z.infer<typeof AccountUserSchema>;
export type OAuthProviderName = z.infer<typeof OAuthProviderSchema>;
export type Host = z.infer<typeof HostSchema>;
export type Session = z.infer<typeof SessionSchema>;
