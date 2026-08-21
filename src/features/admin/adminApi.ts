import { z } from "zod";
import { createHttpClient, type HttpClient } from "../../adapters/http/client";
import {
  AdminCatalogModelsResponseSchema,
  AdminProviderResponseSchema,
  AdminProviderSchema,
  AdminProvidersResponseSchema,
  AdminRoutesResponseSchema,
  AdminServingModelResponseSchema,
  AdminSessionSchema,
  type AdminProviderCreate,
  type AdminRouteInput,
  type AdminServingModelCreate,
  type AdminSessionState,
} from "../../runtime/contracts/admin";

/**
 * The staff API, as one typed object.
 *
 * A separate client from `AppServices` on purpose. `AppServices` is the
 * customer app's container — it has a demo implementation, it is handed to
 * every screen, and it is built at the root for a visitor who may have no
 * account. None of that fits here: there is no demo admin backend to stand in
 * for, no customer screen should be able to reach these calls by accident, and
 * a staff session rides a different cookie (`deev_admin`) from a customer one
 * precisely so the two are never confused.
 *
 * Every response is parsed. A panel that renders an unvalidated payload is a
 * panel that can show the wrong provider as the one serving a model, which is a
 * lie about which account a job is billed to.
 */

/**
 * `mfa_required` is a state, not an error.
 *
 * `POST /admin/session` answers 202 with it: the session exists and authorises
 * nothing. Modelling it as a thrown error would make the sign-in screen catch
 * its own success.
 */
const SignInResultSchema = z.object({ status: z.literal("mfa_required") });
const MfaResultSchema = z.object({
  status: z.literal("authed"),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

/**
 * `v_invite_performance`, which is a code plus what it actually achieved.
 *
 * Loose, unlike every customer contract here, and that is a deliberate
 * asymmetry: a customer contract is a promise about a payload the product
 * depends on, while this is a staff report the repository owns. A column added
 * to the view should show up as an unread field, not as a blank screen for the
 * four people who use this page.
 */
const InviteSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    label: z.string().nullable(),
    kind: z.string(),
    isUsable: z.boolean(),
    revokedAt: z.number().nullable(),
    maxRedemptions: z.number().int().nullable(),
    redemptionCount: z.number().int(),
    grantCoins: z.number().int(),
    usersJoined: z.number().int(),
    coinsSpent: z.number(),
    coinsRemaining: z.number(),
    createdAt: z.number(),
  })
  .loose();

/** `v_promo_performance`. Same reasoning as above. */
const PromoSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    label: z.string().nullable(),
    kind: z.enum(["credits", "percent_off", "amount_off", "free_term"]),
    isUsable: z.boolean(),
    revokedAt: z.number().nullable(),
    maxRedemptions: z.number().int().nullable(),
    redemptionCount: z.number().int(),
    coins: z.number().int(),
    percentOff: z.number().nullable(),
    amountOff: z.number().nullable(),
    firstPurchaseOnly: z.boolean(),
    accounts: z.number().int(),
    orderAmount: z.number(),
    createdAt: z.number(),
  })
  .loose();

const InvitesResponseSchema = z.object({ invites: z.array(InviteSchema) });
const PromosResponseSchema = z.object({ promos: z.array(PromoSchema) });
const EarlyAccessSchema = z.object({ enabled: z.boolean() });
const OutcomeSchema = z.object({ outcome: z.enum(["deleted", "revoked"]) }).loose();

export type AdminInvite = z.infer<typeof InviteSchema>;
export type AdminPromo = z.infer<typeof PromoSchema>;

export interface CreateInviteInput {
  code?: string;
  label?: string;
  grantCoins?: number;
  grantExpiresDays?: number;
  maxRedemptions?: number;
  count?: number;
}

export interface CreatePromoInput {
  /** Required by the server: it decides which of the amount fields is read. */
  kind: "credits" | "percent_off" | "amount_off" | "free_term";
  code?: string;
  label?: string;
  coins?: number;
  percentOff?: number;
  amountOff?: number;
  firstPurchaseOnly?: boolean;
  maxRedemptions?: number;
}

export interface AdminApi {
  getSession(): Promise<AdminSessionState>;
  signIn(email: string, password: string): Promise<void>;
  submitSecondFactor(code: string): Promise<{ roles: string[]; permissions: string[] }>;
  signOut(): Promise<void>;

  listProviders(): Promise<z.infer<typeof AdminProvidersResponseSchema>>;
  patchProvider(id: string, patch: { isActive?: boolean; baseUrl?: string | null; name?: string }): Promise<void>;
  createProvider(input: AdminProviderCreate): Promise<void>;

  listModels(): Promise<z.infer<typeof AdminCatalogModelsResponseSchema>>;
  createServingModel(input: AdminServingModelCreate): Promise<void>;
  listRoutes(modelId: string): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  replaceRoutes(modelId: string, routes: AdminRouteInput[]): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  /** Make one destination the winner. The server picks the priority. */
  routeTo(modelId: string, servingModelId: string): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  clearRoutes(modelId: string): Promise<void>;

  listInvites(): Promise<AdminInvite[]>;
  createInvite(input: CreateInviteInput): Promise<AdminInvite[]>;
  removeInvite(id: string): Promise<"deleted" | "revoked">;

  listPromos(): Promise<AdminPromo[]>;
  createPromo(input: CreatePromoInput): Promise<void>;
  removePromo(id: string): Promise<"deleted" | "revoked">;

  getEarlyAccess(): Promise<boolean>;
  setEarlyAccess(enabled: boolean): Promise<boolean>;
}

/** 204 and 200-with-no-body both parse as this. */
const Empty = z.unknown().transform(() => undefined as void);

export function createAdminApi(client: HttpClient): AdminApi {
  return {
    getSession: () => client.request("/admin/session", { schema: AdminSessionSchema }),
    signIn: async (email, password) => {
      await client.request("/admin/session", { method: "POST", body: { email, password }, schema: SignInResultSchema });
    },
    submitSecondFactor: (code) => client.request("/admin/session/mfa", { method: "POST", body: { code }, schema: MfaResultSchema }),
    signOut: async () => {
      await client.request("/admin/session", { method: "DELETE", schema: Empty });
    },

    listProviders: () => client.request("/admin/providers", { schema: AdminProvidersResponseSchema }),
    patchProvider: async (id, patch) => {
      await client.request(`/admin/providers/${id}`, { method: "PATCH", body: patch, schema: z.object({ provider: AdminProviderSchema }) });
    },

    createProvider: async (input) => {
      await client.request("/admin/providers", { method: "POST", body: input, schema: AdminProviderResponseSchema });
    },

    listModels: () => client.request("/admin/models", { schema: AdminCatalogModelsResponseSchema }),
    createServingModel: async (input) => {
      await client.request("/admin/serving-models", { method: "POST", body: input, schema: AdminServingModelResponseSchema });
    },
    routeTo: (modelId, servingModelId) =>
      client.request(`/admin/models/${modelId}/route-to`, {
        method: "POST",
        body: { servingModelId },
        schema: AdminRoutesResponseSchema,
      }),
    listRoutes: (modelId) => client.request(`/admin/models/${modelId}/routes`, { schema: AdminRoutesResponseSchema }),
    replaceRoutes: (modelId, routes) =>
      client.request(`/admin/models/${modelId}/routes`, { method: "PUT", body: { routes }, schema: AdminRoutesResponseSchema }),
    clearRoutes: async (modelId) => {
      // Answers `{ routes: [] }`, not 204 — clearing sends the variant back to
      // the provider that owns its catalogue row, which is a state, not a void.
      await client.request(`/admin/models/${modelId}/routes`, { method: "DELETE", schema: AdminRoutesResponseSchema });
    },

    listInvites: async () => (await client.request("/admin/invites", { schema: InvitesResponseSchema })).invites,
    createInvite: async (input) =>
      (await client.request("/admin/invites", { method: "POST", body: input, schema: InvitesResponseSchema })).invites,
    removeInvite: async (id) => (await client.request(`/admin/invites/${id}`, { method: "DELETE", schema: OutcomeSchema })).outcome,

    listPromos: async () => (await client.request("/admin/promos", { schema: PromosResponseSchema })).promos,
    createPromo: async (input) => {
      await client.request("/admin/promos", { method: "POST", body: input, schema: z.object({ promo: PromoSchema }) });
    },
    removePromo: async (id) => (await client.request(`/admin/promos/${id}`, { method: "DELETE", schema: OutcomeSchema })).outcome,

    getEarlyAccess: async () => (await client.request("/admin/early-access", { schema: EarlyAccessSchema })).enabled,
    setEarlyAccess: async (enabled) =>
      (await client.request("/admin/early-access", { method: "PATCH", body: { enabled }, schema: EarlyAccessSchema })).enabled,
  };
}

export function createAdminApiFor(baseUrl: string): AdminApi {
  return createAdminApi(createHttpClient({ baseUrl }));
}
