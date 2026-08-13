import { z } from "zod";

export const IdentityMethodSchema = z.literal("email");
export const HostSchema = z.literal("web");

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
    z.object({ status: z.literal("loading"), host: HostSchema }),
    z.object({ status: z.literal("anonymous"), host: HostSchema }),
    z.object({
      status: z.literal("authed"),
      host: HostSchema,
      user: AccountUserSchema,
    }),
  ])
  .readonly();

export type AccountUser = z.infer<typeof AccountUserSchema>;
export type Host = z.infer<typeof HostSchema>;
export type Session = z.infer<typeof SessionSchema>;
