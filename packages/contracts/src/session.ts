import { z } from "zod";

/**
 * The identity providers this API can register routes for.
 *
 * Also the `auth_identities.provider` value, so these strings are permanent:
 * changing one would orphan every identity already linked under the old name.
 */
export const OAuthProviderSchema = z.enum(["google", "microsoft"]);

export const CustomerSessionUserSchema = z.object({
  id: z.string().uuid(),
  methods: z.array(z.enum(["email"])).min(1),
  emailNormalized: z.string().email(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  locale: z.enum(["fa", "en"]),
  isTeam: z.boolean(),
});

/**
 * Which social sign-ins this deployment actually has.
 *
 * Each provider is registered only when its credentials are set, so an
 * unconfigured one has no endpoint at all — and until now nothing the browser
 * could read said which. Both buttons were drawn, and the unconfigured one
 * navigated into a 404 after the person had already committed to it.
 *
 * It rides on the session rather than on the catalogue for two reasons. The
 * catalogue is exported to a committed snapshot that CI diffs, so it cannot
 * carry a value that depends on which environment variables a server happens
 * to hold — demo mode's copy could never be right. And this is a fact about
 * how you may sign in, which is what the session is already about.
 *
 * Present on the anonymous arm too, which is the arm that matters: the only
 * people who need it are the ones who are not signed in yet.
 */
const authProviders = { authProviders: z.array(OAuthProviderSchema) };

/**
 * Who is signed in — and nothing else.
 *
 * Split out because it is all the session service can answer. Which providers
 * exist is a fact about how the API was started, not about this request, and
 * the route is where the two are put together.
 */
export const CustomerIdentitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("anonymous"), host: z.literal("web") }),
  z.object({ status: z.literal("authed"), host: z.literal("web"), user: CustomerSessionUserSchema }),
]);

/** What `GET /session` actually answers: the identity plus the doors in. */
export const CustomerSessionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("anonymous"), host: z.literal("web"), ...authProviders }),
  z.object({ status: z.literal("authed"), host: z.literal("web"), user: CustomerSessionUserSchema, ...authProviders }),
]);

export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;
export type CustomerIdentity = z.infer<typeof CustomerIdentitySchema>;
export type CustomerSession = z.infer<typeof CustomerSessionSchema>;
export type CustomerSessionUser = z.infer<typeof CustomerSessionUserSchema>;
