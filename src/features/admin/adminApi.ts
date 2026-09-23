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
import {
  ContentEntriesSchema,
  ContentEntrySchema,
  ContentMediaSchema,
  type ContentEntry,
  type ContentMedia,
  type ContentMediaPurpose,
  type ContentWrite,
  type EditableContentKind,
} from "../../runtime/contracts/content";

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
    expiresAt: z.number().nullable(),
    startsAt: z.number(),
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

/**
 * The analytics payloads.
 *
 * Loose, for the same reason the invite and promo reports are: these are the
 * repository's own numbers rendered for four people, not a promise the product
 * depends on. A column added to an aggregate should show up as a field nobody
 * reads yet, never as a blank dashboard.
 *
 * `grossMarginUsd` is nullable and that is deliberate rather than defensive —
 * with no payment gateway yet, revenue is genuinely zero, and the server sends
 * null so the panel can say "not selling yet" instead of drawing a large
 * negative number that reads as a business losing money.
 */
const OverviewSchema = z
  .object({
    window: z.string(),
    totals: z
      .object({
        coinsSold: z.number(),
        coinsGranted: z.number(),
        coinsSpent: z.number(),
        revenueIrr: z.number(),
        revenueUsd: z.number(),
        providerCostUsd: z.number(),
        grossMarginUsd: z.number().nullable(),
        jobs: z.number(),
        jobsSucceeded: z.number(),
        jobsFailed: z.number(),
        activeUsers: z.number(),
        newUsers: z.number(),
      })
      .loose(),
    standing: z
      .object({
        coinsOutstanding: z.number(),
        coinsHeld: z.number(),
        users: z.number(),
        bannedUsers: z.number(),
      })
      .loose(),
    daily: z.array(
      z
        .object({
          day: z.string(),
          jobs: z.number(),
          coinsSpent: z.number(),
          providerCostUsd: z.number(),
          newUsers: z.number(),
        })
        .loose(),
    ),
  })
  .loose();

const ModelMarginSchema = z.object({
  models: z.array(
    z
      .object({
        variantId: z.string().nullable(),
        name: z.string(),
        providerCode: z.string(),
        jobs: z.number(),
        succeeded: z.number(),
        failed: z.number(),
        coinsCharged: z.number(),
        providerCostUsd: z.number(),
        avgSeconds: z.number().nullable(),
      })
      .loose(),
  ),
});

const ProviderHealthSchema = z.object({
  providers: z.array(
    z
      .object({
        providerCode: z.string(),
        providerName: z.string(),
        attempts: z.number(),
        succeeded: z.number(),
        failed: z.number(),
        avgLatencyMs: z.number().nullable(),
        providerCostUsd: z.number(),
      })
      .loose(),
  ),
});

const UserRowSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    handle: z.string().nullable(),
    displayName: z.string().nullable(),
    createdAt: z.number(),
    coinsBalance: z.number(),
    coinsHeld: z.number(),
    coinsPurchased: z.number(),
    coinsSpent: z.number(),
    jobs: z.number(),
    /* The same jobs by what they produced, and the subscription behind the
       balance. Both were already in the database and neither was ever asked
       for: a job total cannot tell 400 pictures from 400 videos, and a balance
       with no plan beside it does not say how it got there. */
    images: z.number(),
    videos: z.number(),
    audio: z.number(),
    planName: z.string().nullable(),
    planTier: z.number().nullable(),
    providerCostUsd: z.number(),
    lastJobAt: z.number().nullable(),
    activeBans: z.number(),
  })
  .loose();

const UsersPageSchema = z.object({
  users: z.array(UserRowSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const BanSchema = z
  .object({
    id: z.string(),
    scope: z.enum(["platform", "explore", "comments", "generation"]),
    reason: z.string().nullable(),
    createdAt: z.number(),
    expiresAt: z.number().nullable(),
  })
  .loose();

const UserDetailSchema = z.object({
  user: UserRowSchema.extend({
    recentJobs: z.array(
      z
        .object({
          id: z.string(),
          status: z.string(),
          modelKey: z.string().nullable(),
          coinsCharged: z.number(),
          providerCostUsd: z.number().nullable(),
          createdAt: z.number(),
          errorCode: z.string().nullable(),
        })
        .loose(),
    ),
    recentLedger: z.array(
      z
        .object({
          id: z.string(),
          entryType: z.string(),
          coins: z.number(),
          balanceAfterCoins: z.number(),
          note: z.string().nullable(),
          createdAt: z.number(),
        })
        .loose(),
    ),
  }),
  bans: z.array(BanSchema),
});

export type AdminOverview = z.infer<typeof OverviewSchema>;
export type AdminModelMargin = z.infer<typeof ModelMarginSchema>["models"][number];
export type AdminProviderHealth = z.infer<typeof ProviderHealthSchema>["providers"][number];
export type AdminUserRow = z.infer<typeof UserRowSchema>;
export type AdminUserDetail = z.infer<typeof UserDetailSchema>;
export type AdminBan = z.infer<typeof BanSchema>;

export type AnalyticsWindow = "today" | "7d" | "30d" | "all";

export interface AdminUsersQuery {
  search?: string | undefined;
  sort?: "spent" | "purchased" | "balance" | "created" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * An open staff session, as the Security section lists it.
 *
 * No token and no hash. `admin_sessions` stores only a hash of the token and
 * this route has never selected it — what a person needs in order to recognise
 * a session is where it came from and when it was last used, not its secret.
 */
const AdminSessionRowSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    email: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    mfaVerified: z.boolean(),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    expiresAt: z.number(),
    /** True for the session making the request — the row you can identify. */
    current: z.boolean(),
  })
  .loose();

const AdminSessionsResponseSchema = z.object({ sessions: z.array(AdminSessionRowSchema) });
const RevokedSchema = z.object({ revoked: z.number() });

export type AdminSessionRow = z.infer<typeof AdminSessionRowSchema>;

const InvitesResponseSchema = z.object({ invites: z.array(InviteSchema) });
const PromosResponseSchema = z.object({ promos: z.array(PromoSchema) });
const EarlyAccessSchema = z.object({ enabled: z.boolean() });
const SiteBannerSchema = z.object({ enabled: z.boolean() });

/** A generation that failed. `refunded` is the row charging nothing, which is what a refund looks like. */
const FailedJobSchema = z.object({
  id: z.string(),
  at: z.number(),
  status: z.string(),
  customer: z.string().nullable(),
  variantId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  refunded: z.boolean(),
  attempts: z.number(),
});
const FailuresResponseSchema = z.object({ failures: z.array(FailedJobSchema) });

const AuditEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  actor: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  after: z.unknown(),
});
const AuditResponseSchema = z.object({ entries: z.array(AuditEntrySchema) });

/** Rial, as the table stores it. Every number a person reads is Toman, a tenth of this. */
const FxRateSchema = z.object({ rialPerUsd: z.number(), validFrom: z.number(), source: z.string().nullable() });
const FxResponseSchema = z.object({ rate: FxRateSchema.nullable() });

/**
 * A share waiting for a decision.
 *
 * `previewUrl` is the file itself, signed for half an hour — a moderator
 * approving a picture they cannot see is not moderating. It is absent on a
 * post with no stored asset behind it, and the queue says so instead.
 */
const PendingPostSchema = z.object({
  id: z.string(),
  author: z.string(),
  kind: z.enum(["image", "video", "reel"]),
  familyId: z.string(),
  caption: z.string(),
  prompt: z.string(),
  promptVisible: z.boolean(),
  submittedAt: z.number(),
  previewUrl: z.string().optional(),
  previewKind: z.enum(["image", "video"]).optional(),
});
const PendingPostsResponseSchema = z.object({ posts: z.array(PendingPostSchema) });

/** What people have complained about, busiest first. A read over the reports, not a second status on the post. */
const ReportedPostSchema = z.object({
  postId: z.string(),
  caption: z.string(),
  prompt: z.string(),
  author: z.string(),
  reports: z.number(),
  categories: z.array(z.string()),
  firstReportedAt: z.number(),
});
const ReportedPostsResponseSchema = z.object({ reported: z.array(ReportedPostSchema) });
const OutcomeSchema = z.object({ outcome: z.enum(["deleted", "revoked"]) }).loose();
const InviteResponseSchema = z.object({ invite: InviteSchema });

export type AdminInvite = z.infer<typeof InviteSchema>;
export type AdminPromo = z.infer<typeof PromoSchema>;

export interface CreateInviteInput {
  code?: string;
  label?: string;
  grantCoins?: number;
  grantExpiresDays?: number;
  /** Required: how many people the code may admit. */
  maxRedemptions: number;
  /** Required: when the code stops working. Sent as an ISO string. */
  expiresAt: string;
  count?: number;
}

/** Absent fields are left as they are. A past `expiresAt` closes the code now. */
export interface UpdateInviteInput {
  label?: string;
  maxRedemptions?: number;
  expiresAt?: string;
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

/* ------------------------------------------------------------------ staff */

export const StaffMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  roleCode: z.string(),
  roleName: z.string(),
  /** Resolved: their own set where they have one, the role's where they do not. */
  permissions: z.array(z.string()),
  /** True when the set above is theirs rather than the role's. */
  isCustom: z.boolean(),
  hasMfa: z.boolean(),
  grantedAt: z.number(),
  grantedByEmail: z.string().nullable(),
});

const StaffListSchema = z.object({
  staff: z.array(StaffMemberSchema),
  /** What this admin may hand out. The server re-checks; this is so the form does not offer what it will refuse. */
  grantable: z.array(z.string()),
});

const StaffRolesSchema = z.object({
  roles: z.array(z.object({ code: z.string(), name: z.string(), permissions: z.array(z.string()) })),
  grantable: z.array(z.string()),
});

const StaffOneSchema = z.object({ staff: StaffMemberSchema.nullable() });
/** The second-factor key for somebody who had none, returned once by the appointment. */
const StaffTotpSchema = z.object({ secret: z.string(), uri: z.string() });
const StaffAppointedSchema = StaffOneSchema.extend({ totp: StaffTotpSchema.nullable() });
export type StaffTotp = z.infer<typeof StaffTotpSchema>;

export const StaffPlanSchema = z.object({
  subscriptionId: z.string(),
  planCode: z.string(),
  planName: z.string(),
  tier: z.number(),
  coins: z.number(),
  startsAt: z.number(),
  endsAt: z.number(),
  status: z.string(),
});

const StaffPlanResponseSchema = z.object({ plan: StaffPlanSchema.nullable() });
const StaffPlanRevokedSchema = z.object({ userId: z.string(), revoked: z.boolean(), coinsWithdrawn: z.number() });

export type StaffMember = z.infer<typeof StaffMemberSchema>;
export type StaffPlan = z.infer<typeof StaffPlanSchema>;

/**
 * A model family, as the content editor offers it. Read from the public
 * catalogue — the one list of what a customer can actually open.
 */
const AdminFamiliesSchema = z.object({
  families: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["image", "video", "audio"]) })),
});
export type AdminFamily = z.infer<typeof AdminFamiliesSchema>["families"][number];
export type AdminPendingPost = z.infer<typeof PendingPostSchema>;
export type AdminFailedJob = z.infer<typeof FailedJobSchema>;
export type AdminAuditEntry = z.infer<typeof AuditEntrySchema>;
export type AdminFxRate = z.infer<typeof FxRateSchema>;
export type AdminReportedPost = z.infer<typeof ReportedPostSchema>;

export interface AdminApi {
  getSession(): Promise<AdminSessionState>;
  signIn(email: string, password: string): Promise<void>;
  submitSecondFactor(code: string): Promise<{ roles: string[]; permissions: string[] }>;
  signOut(): Promise<void>;

  listProviders(): Promise<z.infer<typeof AdminProvidersResponseSchema>>;
  patchProvider(id: string, patch: { isActive?: boolean; baseUrl?: string | null; name?: string }): Promise<void>;
  createProvider(input: AdminProviderCreate): Promise<void>;

  listModels(): Promise<z.infer<typeof AdminCatalogModelsResponseSchema>>;
  /** Show a model in the shop, or stop showing it. */
  setModelActive(id: string, isActive: boolean): Promise<void>;
  createServingModel(input: AdminServingModelCreate): Promise<void>;
  listRoutes(modelId: string): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  replaceRoutes(modelId: string, routes: AdminRouteInput[]): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  /** Make one destination the winner. The server picks the priority. */
  routeTo(modelId: string, servingModelId: string): Promise<z.infer<typeof AdminRoutesResponseSchema>>;
  clearRoutes(modelId: string): Promise<void>;

  listInvites(): Promise<AdminInvite[]>;
  createInvite(input: CreateInviteInput): Promise<AdminInvite[]>;
  updateInvite(id: string, input: UpdateInviteInput): Promise<AdminInvite>;
  removeInvite(id: string): Promise<"deleted" | "revoked">;

  listPromos(): Promise<AdminPromo[]>;
  createPromo(input: CreatePromoInput): Promise<void>;
  removePromo(id: string): Promise<"deleted" | "revoked">;

  getEarlyAccess(): Promise<boolean>;
  setEarlyAccess(enabled: boolean): Promise<boolean>;

  listFailures(): Promise<AdminFailedJob[]>;
  listAuditTrail(action?: string): Promise<AdminAuditEntry[]>;
  getFxRate(): Promise<AdminFxRate | null>;
  /** Ask the market now, with no plausibility band — a person pressing this is the override. */
  refreshFxRate(): Promise<AdminFxRate | null>;
  setFxRate(tomanPerUsd: number): Promise<AdminFxRate | null>;

  getSiteBanner(): Promise<boolean>;
  setSiteBanner(enabled: boolean): Promise<boolean>;

  listPendingPosts(): Promise<AdminPendingPost[]>;
  decidePost(id: string, decision: "approve" | "reject", reason?: string): Promise<void>;
  listReportedPosts(): Promise<AdminReportedPost[]>;
  /** How many open reports were marked looked at. */
  resolveReports(id: string): Promise<number>;
  takeDownPost(id: string, reason: string): Promise<void>;

  getOverview(window: AnalyticsWindow): Promise<AdminOverview>;
  listModelMargin(window: AnalyticsWindow): Promise<AdminModelMargin[]>;
  listProviderHealth(window: AnalyticsWindow): Promise<AdminProviderHealth[]>;

  listUsers(query: AdminUsersQuery): Promise<z.infer<typeof UsersPageSchema>>;
  getUser(id: string): Promise<AdminUserDetail>;
  adjustCredits(id: string, input: { coins: number; note: string }): Promise<void>;
  banUser(id: string, input: { scope: AdminBan["scope"]; reason?: string; expiresAt?: string }): Promise<void>;
  liftBan(id: string, banId: string): Promise<AdminBan[]>;
  revokeUserSessions(id: string): Promise<number>;

  listStaff(): Promise<{ staff: StaffMember[]; grantable: string[] }>;
  listStaffRoles(): Promise<{ roles: { code: string; name: string; permissions: string[] }[]; grantable: string[] }>;
  /** `password` creates the account for an address nobody uses yet. */
  appointStaff(input: {
    email: string;
    roleCode: string;
    permissions?: string[] | undefined;
    password?: string | undefined;
  }): Promise<StaffTotp | null>;
  /** Null hands the role's own set back; an array pins this person's. */
  setStaffPermissions(userId: string, permissions: string[] | null): Promise<void>;
  revokeStaff(userId: string): Promise<void>;

  getStaffPlan(userId: string): Promise<StaffPlan | null>;
  grantStaffPlan(userId: string, planCode: string): Promise<void>;
  revokeStaffPlan(userId: string): Promise<number>;

  listAdminSessions(): Promise<AdminSessionRow[]>;
  revokeAdminSession(id: string): Promise<void>;
  revokeOtherAdminSessions(): Promise<number>;

  listFamilies(): Promise<AdminFamily[]>;
  listContent(kind: EditableContentKind): Promise<ContentEntry[]>;
  createContent(write: ContentWrite): Promise<ContentEntry>;
  updateContent(id: string, write: ContentWrite): Promise<ContentEntry>;
  /** Archives it: gone from the site and this panel. */
  deleteContent(id: string): Promise<void>;
  /** One place up or down the order the site draws. At either end it is a no-op. */
  moveContent(id: string, direction: "up" | "down"): Promise<"moved" | "at_the_end" | "not_found">;
  /** Publish or unpublish several at once; answers how many changed. */
  setContentStatus(ids: string[], status: "draft" | "published"): Promise<number>;
  uploadContentMedia(file: File, purpose: ContentMediaPurpose): Promise<ContentMedia>;
}

/** 204 and 200-with-no-body both parse as this. */
const Empty = z.unknown().transform(() => undefined as void);

/**
 * `uploads` is the same API with a longer patience: a 150MB lesson does not
 * arrive in the fifteen seconds every other call gets. Defaults to `client`
 * for the tests, which upload nothing that size.
 */
export function createAdminApi(client: HttpClient, uploads: HttpClient = client): AdminApi {
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
    setModelActive: async (id, isActive) => {
      await client.request(`/admin/models/${id}`, { method: "PATCH", body: { isActive }, schema: z.object({ model: z.unknown() }) });
    },
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
    updateInvite: async (id, input) =>
      (await client.request(`/admin/invites/${id}`, { method: "PATCH", body: input, schema: InviteResponseSchema })).invite,
    removeInvite: async (id) => (await client.request(`/admin/invites/${id}`, { method: "DELETE", schema: OutcomeSchema })).outcome,

    listPromos: async () => (await client.request("/admin/promos", { schema: PromosResponseSchema })).promos,
    createPromo: async (input) => {
      await client.request("/admin/promos", { method: "POST", body: input, schema: z.object({ promo: PromoSchema }) });
    },
    removePromo: async (id) => (await client.request(`/admin/promos/${id}`, { method: "DELETE", schema: OutcomeSchema })).outcome,

    getOverview: (window) => client.request(`/admin/analytics/overview?window=${window}`, { schema: OverviewSchema }),
    listModelMargin: async (window) =>
      (await client.request(`/admin/analytics/models?window=${window}`, { schema: ModelMarginSchema })).models,
    listProviderHealth: async (window) =>
      (await client.request(`/admin/analytics/providers?window=${window}`, { schema: ProviderHealthSchema })).providers,

    listUsers: (query) => {
      const search = new URLSearchParams();
      if (query.search) search.set("search", query.search);
      if (query.sort) search.set("sort", query.sort);
      if (query.limit !== undefined) search.set("limit", String(query.limit));
      if (query.offset !== undefined) search.set("offset", String(query.offset));
      const qs = search.toString();
      return client.request(`/admin/users${qs ? `?${qs}` : ""}`, { schema: UsersPageSchema });
    },
    getUser: (id) => client.request(`/admin/users/${id}`, { schema: UserDetailSchema }),
    adjustCredits: async (id, input) => {
      await client.request(`/admin/users/${id}/credits`, { method: "POST", body: input, schema: Empty });
    },
    banUser: async (id, input) => {
      await client.request(`/admin/users/${id}/bans`, { method: "POST", body: input, schema: Empty });
    },
    liftBan: async (id, banId) =>
      (await client.request(`/admin/users/${id}/bans/${banId}`, { method: "DELETE", schema: z.object({ bans: z.array(BanSchema) }) })).bans,
    revokeUserSessions: async (id) =>
      (await client.request(`/admin/users/${id}/sessions`, { method: "DELETE", schema: z.object({ revoked: z.number() }) })).revoked,

    listAdminSessions: async () => (await client.request("/admin/sessions", { schema: AdminSessionsResponseSchema })).sessions,
    revokeAdminSession: async (id) => {
      await client.request(`/admin/sessions/${id}`, { method: "DELETE", schema: RevokedSchema });
    },
    revokeOtherAdminSessions: async () => (await client.request("/admin/sessions", { method: "DELETE", schema: RevokedSchema })).revoked,

    listStaff: () => client.request("/admin/staff", { schema: StaffListSchema }),
    listStaffRoles: () => client.request("/admin/staff/roles", { schema: StaffRolesSchema }),
    appointStaff: async ({ email, roleCode, permissions, password }) =>
      (
        await client.request("/admin/staff", {
          method: "POST",
          // Omitted rather than sent as null: the server reads an absent field as
          // "inherit the role", which is a different instruction from an empty
          // array — that one would mean a member of staff who can do nothing.
          body: { email, roleCode, ...(permissions ? { permissions } : {}), ...(password ? { password } : {}) },
          schema: StaffAppointedSchema,
        })
      ).totp,
    setStaffPermissions: async (userId, permissions) => {
      await client.request(`/admin/staff/${userId}`, { method: "PATCH", body: { permissions }, schema: StaffOneSchema });
    },
    revokeStaff: async (userId) => {
      await client.request(`/admin/staff/${userId}`, { method: "DELETE", schema: z.object({ userId: z.string(), revoked: z.boolean() }) });
    },

    getStaffPlan: async (userId) => (await client.request(`/admin/staff/${userId}/plan`, { schema: StaffPlanResponseSchema })).plan,
    grantStaffPlan: async (userId, planCode) => {
      await client.request(`/admin/staff/${userId}/plan`, { method: "POST", body: { planCode }, schema: StaffPlanResponseSchema });
    },
    revokeStaffPlan: async (userId) =>
      (await client.request(`/admin/staff/${userId}/plan`, { method: "DELETE", schema: StaffPlanRevokedSchema })).coinsWithdrawn,

    listFailures: async () => (await client.request("/admin/ops/failures", { schema: FailuresResponseSchema })).failures,
    listAuditTrail: async (action) =>
      (await client.request(`/admin/ops/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`, { schema: AuditResponseSchema }))
        .entries,
    getFxRate: async () => (await client.request("/admin/ops/fx", { schema: FxResponseSchema })).rate,
    refreshFxRate: async () => (await client.request("/admin/ops/fx/refresh", { method: "POST", schema: FxResponseSchema })).rate,
    setFxRate: async (tomanPerUsd) =>
      (await client.request("/admin/ops/fx", { method: "PATCH", body: { tomanPerUsd }, schema: FxResponseSchema })).rate,

    getSiteBanner: async () => (await client.request("/admin/site-banner", { schema: SiteBannerSchema })).enabled,
    setSiteBanner: async (enabled) =>
      (await client.request("/admin/site-banner", { method: "PATCH", body: { enabled }, schema: SiteBannerSchema })).enabled,

    listPendingPosts: async () => (await client.request("/admin/community/pending", { schema: PendingPostsResponseSchema })).posts,
    decidePost: async (id, decision, reason) => {
      await client.request(`/admin/community/pending/${id}`, {
        method: "POST",
        body: { decision, ...(reason ? { reason } : {}) },
        schema: z.object({ id: z.string(), status: z.string() }),
      });
    },
    listReportedPosts: async () => (await client.request("/admin/community/reports", { schema: ReportedPostsResponseSchema })).reported,
    resolveReports: async (id) =>
      (await client.request(`/admin/community/reports/${id}/resolve`, { method: "POST", schema: z.object({ resolved: z.number() }) }))
        .resolved,
    takeDownPost: async (id, reason) => {
      await client.request(`/admin/community/posts/${id}`, {
        method: "DELETE",
        body: { reason },
        schema: z.object({ id: z.string(), visible: z.boolean() }),
      });
    },

    getEarlyAccess: async () => (await client.request("/admin/early-access", { schema: EarlyAccessSchema })).enabled,
    setEarlyAccess: async (enabled) =>
      (await client.request("/admin/early-access", { method: "PATCH", body: { enabled }, schema: EarlyAccessSchema })).enabled,

    listFamilies: async () => (await client.request("/catalog", { schema: AdminFamiliesSchema })).families,
    listContent: async (kind) => (await client.request(`/admin/content?kind=${kind}`, { schema: ContentEntriesSchema })).entries,
    createContent: async (write) =>
      (await client.request("/admin/content", { method: "POST", body: write, schema: z.object({ entry: ContentEntrySchema }) })).entry,
    updateContent: async (id, write) =>
      (await client.request(`/admin/content/${id}`, { method: "PUT", body: write, schema: z.object({ entry: ContentEntrySchema }) })).entry,
    moveContent: async (id, direction) =>
      (
        await client.request(`/admin/content/${id}/move`, {
          method: "POST",
          body: { direction },
          schema: z.object({ id: z.string(), outcome: z.enum(["moved", "at_the_end", "not_found"]) }),
        })
      ).outcome,
    setContentStatus: async (ids, status) =>
      (await client.request("/admin/content/bulk", { method: "POST", body: { ids, status }, schema: z.object({ changed: z.number() }) }))
        .changed,
    deleteContent: async (id) => {
      await client.request(`/admin/content/${id}`, { method: "DELETE", schema: Empty });
    },
    uploadContentMedia: (file, purpose) => {
      const form = new FormData();
      form.append("file", file);
      return uploads.request(`/admin/content/media?purpose=${purpose}`, { method: "POST", body: form, schema: ContentMediaSchema });
    },
  };
}

export function createAdminApiFor(baseUrl: string): AdminApi {
  return createAdminApi(createHttpClient({ baseUrl }), createHttpClient({ baseUrl, timeoutMs: 20 * 60_000 }));
}
