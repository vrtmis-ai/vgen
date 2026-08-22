import { z } from "zod";

/**
 * The staff surface for providers and routing.
 *
 * What this exists to answer is one question a person needs to be able to act
 * on without a deploy: *which provider, and which of their models, actually
 * runs this thing we sell?* Until now that was decided by which
 * `provider_models` row happened to carry the presentation JSON, and changing
 * it meant editing the catalogue — the same rows the shop, the prices and every
 * past job point at.
 *
 * One rule runs through the whole file and is the reason several fields look
 * thinner than they could be: **`secret_ref` values travel, secrets never do.**
 * The column stores the *name* of an environment variable by design, so the
 * panel can tell an admin that `WAVESPEED_API_KEY` is the key it wants and
 * whether it is set, without the key itself ever leaving the process.
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
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/**
 * An environment variable's name, and nothing else.
 *
 * Two rules, both with teeth. The shape is the shell's — a leading letter, then
 * upper-case, digits and underscores — because `secret_ref` is looked up in
 * `process.env`, and a name the shell cannot export is a credential that can
 * never be set.
 *
 * The second matters more. **`NEXT_PUBLIC_` is refused outright.** Next inlines
 * anything carrying that prefix into the browser bundle at build time, and this
 * repository is public. A provider key named that way would not leak one day;
 * it would be built into the client and served to every visitor the moment
 * somebody set it.
 */
export const SecretRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/, "An environment variable name: A-Z, 0-9 and underscore, starting with a letter")
  .refine((value) => !value.startsWith("NEXT_PUBLIC_"), {
    message: "NEXT_PUBLIC_ is the browser bundle, and this repository is public. A provider key must never carry that prefix.",
  });

/**
 * A new provider, as an admin proposes one.
 *
 * It arrives unable to do anything, which is correct rather than unfortunate:
 * `hasAdapter` is false until somebody writes one, and `configured` is false
 * until a deploy sets the variable named here. The panel shows both in red
 * instead of pretending the provider is ready.
 *
 * `unitCostUsd` is optional and worth filling in anyway. It becomes the open
 * `provider_credit_rates` row, and a provider without one records no cost
 * against the jobs it runs — a hole in the margin trail rather than a zero in
 * it.
 */
export const AdminProviderCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/, "Lower-case letters, digits and dashes, starting with a letter"),
    name: z.string().trim().min(1).max(120),
    baseUrl: z.url().max(500).optional(),
    secretRef: SecretRefSchema,
    /** What THEY call their unit: 'credit' for KIE, 'usd' for one that bills in dollars. */
    creditUnitName: z.string().trim().min(1).max(32).default("credit"),
    /** What one of their units costs us. Opens a `provider_credit_rates` row. */
    unitCostUsd: z.number().positive().max(1_000).optional(),
  })
  .strict();

/** A `provider_models` row that is not in the shop — somewhere a variant can be sent. */
export const AdminServingModelSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerCode: z.string(),
  /** The provider's display name. Carried so a picker can group by it without a second request. */
  providerName: z.string(),
  externalModelId: z.string(),
  name: z.string(),
  modality: z.enum(["image", "video", "audio", "text"]),
  isActive: z.boolean(),
});

/**
 * A new routing destination.
 *
 * There is no `capabilities` field here and there never will be one. A
 * `provider_models` row carrying a `variant` key is a thing in the shop —
 * `catalogRepository` decides exactly that way — so letting this endpoint set
 * capabilities would let a routing target become something a customer can buy.
 * The repository writes `{}` and an integration test asserts the row never
 * reaches the catalogue.
 */
export const AdminServingModelCreateSchema = z
  .object({
    providerId: z.uuid(),
    externalModelId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    modality: z.enum(["image", "video", "audio", "text"]),
  })
  .strict();

/**
 * "Run this variant here, now."
 *
 * The entire body. Priority is deliberately not offered: the point of this
 * route is that the caller does not have to reason about it — the server picks
 * one that wins and stands down whatever was winning before, in a single
 * transaction. An admin who wants to express something more complicated than
 * "this one" uses `PUT /routes`, which still takes the whole ordered list.
 */
export const AdminRouteToSchema = z.object({ servingModelId: z.uuid() }).strict();

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
  /**
   * Everywhere this variant has been declared able to run, active or not: its
   * routes, plus any unlimited-entitlement pairing.
   *
   * This is what a "move it somewhere else" picker must be built from. Whether
   * another provider hosts this exact model is a fact about that provider, and
   * only a person can assert it; a same-modality match asserts nothing beyond
   * "both make images", which would put Qwen Image on the menu for Nano Banana
   * Pro and sell one under the other's name.
   */
  routeTargetIds: z.array(z.uuid()),
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
export const AdminProviderResponseSchema = z.object({ provider: AdminProviderSchema });
export const AdminServingModelResponseSchema = z.object({ servingModel: AdminServingModelSchema });

export type AdminSessionState = z.infer<typeof AdminSessionSchema>;
export type RouteParamOverrides = z.infer<typeof ParamOverridesSchema>;
export type AdminProvider = z.infer<typeof AdminProviderSchema>;
export type AdminCredential = z.infer<typeof AdminCredentialSchema>;
export type AdminServingModel = z.infer<typeof AdminServingModelSchema>;
export type AdminRoute = z.infer<typeof AdminRouteSchema>;
export type AdminCatalogModel = z.infer<typeof AdminCatalogModelSchema>;
export type AdminRouteInput = z.infer<typeof AdminRouteInputSchema>;
export type AdminProviderCreate = z.infer<typeof AdminProviderCreateSchema>;
export type AdminServingModelCreate = z.infer<typeof AdminServingModelCreateSchema>;
