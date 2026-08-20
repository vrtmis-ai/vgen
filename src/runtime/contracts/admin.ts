import { z } from "zod";

/**
 * The staff surface, as `GET|PATCH|PUT /api/v1/admin/*` serves it.
 *
 * Deliberately a copy of `packages/contracts/src/admin.ts` rather than an
 * import of it: this is the browser's statement of what it will accept, and
 * the server's is what it promises to send. A panel that quietly rendered a
 * field whose meaning changed would be a panel lying about money, since the
 * fields here decide which provider account a job is billed to.
 *
 * One rule runs through the whole file and is why several fields look thinner
 * than they could be: **`secretRef` values travel, secrets never do.** The
 * column stores the *name* of an environment variable by design, so the panel
 * can say that `WAVESPEED_API_KEY` is the key it wants and whether it is set,
 * without the key itself ever leaving the server process.
 */
/**
 * Who the staff session belongs to, and what it may do.
 *
 * `permissions` is empty while `status` is `mfa_required`, which is not a
 * detail: it means a panel can render straight off this array without also
 * remembering to check the status, and a half-authenticated session cannot
 * draw a section it would be refused from.
 */
export const AdminSessionSchema = z.object({
  status: z.enum(["authed", "mfa_required"]),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export const ParamOverridesSchema = z
  .object({
    /** `{ from: to }` — applied first, so everything after speaks the destination's vocabulary. */
    rename: z.record(z.string().min(1), z.string().min(1)).optional(),
    /** `{ key: { fromValue: toValue } }` — translates the value, keyed by the post-rename name. */
    map: z.record(z.string().min(1), z.record(z.string(), z.string())).optional(),
    /** Applied over whatever is there, so it wins on a collision. */
    set: z.record(z.string().min(1), z.unknown()).optional(),
    /** Applied last, so a key renamed into and then dropped stays dropped. */
    drop: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const AdminCredentialSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  /** The environment variable's NAME. Never its value. */
  secretRef: z.string(),
  /**
   * Whether that variable is actually set in the process answering this. A
   * false here is the difference between "misconfigured" and "broken", and it
   * is the single most common reason a newly routed model refuses to run.
   */
  configured: z.boolean(),
  isActive: z.boolean(),
  dailyRequestCap: z.number().int().positive().nullable(),
  lastUsedAt: z.number().int().nonnegative().nullable(),
});

export const AdminProviderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  baseUrl: z.string().nullable(),
  isActive: z.boolean(),
  /**
   * Whether `createGenerationProvider` knows how to call this one. A provider
   * row with no adapter can be created and credentialed and will still refuse
   * every job, so the panel says so rather than letting someone route to it and
   * find out from a refund.
   */
  hasAdapter: z.boolean(),
  /** What one of their own units costs us, effective now. Null when no rate is on file. */
  unitCostUsd: z.number().nullable(),
  credentials: z.array(AdminCredentialSchema),
});

export const AdminProviderPatchSchema = z
  .object({
    isActive: z.boolean().optional(),
    baseUrl: z.url().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/** A `provider_models` row that is not in the shop — somewhere a variant can be sent. */
export const AdminServingModelSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerCode: z.string(),
  externalModelId: z.string(),
  name: z.string(),
  modality: z.enum(["image", "video", "audio", "text"]),
  isActive: z.boolean(),
});

export const AdminRouteSchema = z.object({
  id: z.uuid(),
  servingModelId: z.uuid(),
  providerCode: z.string(),
  externalModelId: z.string(),
  priority: z.number().int(),
  isActive: z.boolean(),
  paramOverrides: ParamOverridesSchema,
  note: z.string().nullable(),
});

/** A catalogue variant, and where it is currently being sent. */
export const AdminCatalogModelSchema = z.object({
  id: z.uuid(),
  variantId: z.string(),
  familyId: z.string().nullable(),
  name: z.string(),
  modality: z.enum(["image", "video", "audio", "text"]),
  isActive: z.boolean(),
  /** The provider that owns the catalogue row itself — where it runs with no route. */
  homeProviderCode: z.string(),
  homeExternalModelId: z.string(),
  /**
   * What would actually serve a job submitted right now: the lowest-priority
   * active route, or the catalogue row itself. This is the field a panel shows
   * as "running on", and it is computed the same way `claim()` computes it so
   * the two cannot disagree.
   */
  servingProviderCode: z.string(),
  servingExternalModelId: z.string(),
  routeCount: z.number().int().nonnegative(),
  activeRouteCount: z.number().int().nonnegative(),
});

/**
 * One route as an admin proposes it.
 *
 * No id: `PUT` replaces the whole list for a variant rather than patching rows
 * one at a time. The partial unique index on (catalog_model_id, priority) means
 * two sequential writes can collide on a priority that is only transiently
 * taken, and a single atomic replace has no such window.
 */
export const AdminRouteInputSchema = z
  .object({
    servingModelId: z.uuid(),
    priority: z.number().int().min(0).max(10_000),
    isActive: z.boolean().default(false),
    paramOverrides: ParamOverridesSchema.default({}),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const AdminRoutesPutSchema = z
  .object({
    routes: z.array(AdminRouteInputSchema).max(20),
  })
  .strict()
  .refine((value) => new Set(value.routes.map((route) => route.servingModelId)).size === value.routes.length, {
    message: "A serving model may only appear once",
  })
  .refine(
    (value) => {
      const active = value.routes.filter((route) => route.isActive).map((route) => route.priority);
      return new Set(active).size === active.length;
    },
    // Caught here as well as by the index so the message says what is wrong
    // rather than surfacing a constraint name.
    { message: "Two active routes cannot share a priority" },
  );

export const AdminProvidersResponseSchema = z.object({ providers: z.array(AdminProviderSchema) });
export const AdminCatalogModelsResponseSchema = z.object({
  models: z.array(AdminCatalogModelSchema),
  /** Every non-catalogue row, so a panel can offer somewhere to route to. */
  servingModels: z.array(AdminServingModelSchema),
});
export const AdminRoutesResponseSchema = z.object({ routes: z.array(AdminRouteSchema) });

export type AdminSessionState = z.infer<typeof AdminSessionSchema>;
export type RouteParamOverrides = z.infer<typeof ParamOverridesSchema>;
export type AdminProvider = z.infer<typeof AdminProviderSchema>;
export type AdminCredential = z.infer<typeof AdminCredentialSchema>;
export type AdminServingModel = z.infer<typeof AdminServingModelSchema>;
export type AdminRoute = z.infer<typeof AdminRouteSchema>;
export type AdminCatalogModel = z.infer<typeof AdminCatalogModelSchema>;
export type AdminRouteInput = z.infer<typeof AdminRouteInputSchema>;
