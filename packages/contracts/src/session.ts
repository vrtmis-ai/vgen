import { z } from "zod";

export const CustomerSessionUserSchema = z.object({
  id: z.string().uuid(),
  methods: z.array(z.enum(["email"])).min(1),
  emailNormalized: z.string().email(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  locale: z.enum(["fa", "en"]),
  isTeam: z.boolean(),
});

export const CustomerSessionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("anonymous"), host: z.literal("web") }),
  z.object({ status: z.literal("authed"), host: z.literal("web"), user: CustomerSessionUserSchema }),
]);

export type CustomerSession = z.infer<typeof CustomerSessionSchema>;
export type CustomerSessionUser = z.infer<typeof CustomerSessionUserSchema>;
