import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAdminRoutes } from "./admin";

/**
 * The staff surface for providers and routing.
 *
 * Three things are worth testing here and only three, because the rest is the
 * repository's job:
 *
 *   1. the gate. Every route is behind the same permission check the invite and
 *      promo routes use, and a route that forgot it would be a way to move
 *      production traffic to another provider with no second factor.
 *   2. secrets do not cross the boundary. `secret_ref` travels because it is a
 *      variable *name*; the value must not, and `configured` is the only thing
 *      derived from it.
 *   3. every mutation is audited before it answers. `audit_log` is append-only
 *      at the database, so this record is the only account of who changed where
 *      a model runs.
 */

const ADMIN = {
  sessionId: "s1",
  userId: "u-admin",
  email: "admin@deev.test",
  roles: ["admin"],
  permissions: ["*"],
  hasMfa: true,
  mfaVerified: true,
};

const PROVIDER = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "wavespeed",
  name: "WaveSpeed",
  baseUrl: "https://api.wavespeed.ai",
  isActive: true,
  unitCostUsd: 1,
  credentials: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      label: "wavespeed-primary",
      secretRef: "WAVESPEED_API_KEY",
      isActive: true,
      dailyRequestCap: null,
      lastUsedAt: null,
    },
  ],
};

const CATALOG_MODEL_ID = "33333333-3333-4333-8333-333333333333";
const SERVING_MODEL_ID = "44444444-4444-4444-8444-444444444444";

const ROUTE = {
  id: "55555555-5555-4555-8555-555555555555",
  servingModelId: SERVING_MODEL_ID,
  providerCode: "wavespeed",
  externalModelId: "wavespeed-ai/qwen-image/text-to-image",
  priority: 10,
  isActive: false,
  paramOverrides: { rename: { aspect_ratio: "size" } },
  note: null,
};

function build(session: Partial<typeof ADMIN> | null = ADMIN, secrets: Record<string, string | undefined> = {}) {
  const admin = {
    resolveSession: vi.fn(async (_token: string) => (session ? { ...ADMIN, ...session } : null)),
    recordAudit: vi.fn(async () => undefined),
  };
  const routes = {
    listProviders: vi.fn(async () => [PROVIDER]),
    getProvider: vi.fn(async () => PROVIDER),
    updateProvider: vi.fn(async (_id: string, patch: { isActive?: boolean }) => ({ ...PROVIDER, ...patch })),
    listCatalogModels: vi.fn(async () => [
      {
        id: CATALOG_MODEL_ID,
        variantId: "qwen-image",
        familyId: "qwen",
        name: "Qwen Image",
        modality: "image" as const,
        isActive: true,
        homeProviderCode: "kie",
        homeExternalModelId: "qwen/text-to-image",
        servingProviderCode: "kie",
        servingExternalModelId: "qwen/text-to-image",
        routeCount: 1,
        activeRouteCount: 0,
        routeTargets: [
          {
            servingModelId: SERVING_MODEL_ID,
            providerCode: "wavespeed",
            externalModelId: "wavespeed-ai/qwen-image/text-to-image",
            priority: 10,
            isActive: false,
            source: "route" as const,
          },
        ],
      },
    ]),
    listServingModels: vi.fn(async () => [
      {
        id: SERVING_MODEL_ID,
        providerId: PROVIDER.id,
        providerCode: "wavespeed",
        providerName: "WaveSpeed",
        externalModelId: "wavespeed-ai/qwen-image/text-to-image",
        name: "Qwen Image (WaveSpeed)",
        modality: "image" as const,
        isActive: true,
      },
    ]),
    listRoutes: vi.fn(async () => [ROUTE]),
    replaceRoutes: vi.fn(async (_id: string, input: { isActive: boolean }[]) => input.map((route) => ({ ...ROUTE, ...route }))),
    createProvider: vi.fn(async (input: { code: string; name: string }) => ({ ...PROVIDER, ...input })),
    createServingModel: vi.fn(async (input: { externalModelId: string; name: string }) => ({
      id: "66666666-6666-4666-8666-666666666666",
      providerId: PROVIDER.id,
      providerCode: "wavespeed",
      providerName: "WaveSpeed",
      modality: "image" as const,
      isActive: true,
      ...input,
    })),
    routeTo: vi.fn(async () => [{ ...ROUTE, isActive: true }]),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAdminRoutes(
    app,
    {
      admin: admin as never,
      access: {} as never,
      verifyPassword: vi.fn() as never,
      catalog: { routes: routes as never, secrets },
    },
    { cookie: { secure: true } },
  );
  return { app, admin, routes };
}

const AS_ADMIN = { cookie: "deev_admin=adm-tok" };

describe("reaching the routing surface", () => {
  it("answers 404 with no staff session, not 401", async () => {
    const { app } = build(null);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN })).statusCode).toBe(404);
    await app.close();
  });

  it("refuses a staff session that has not passed its second factor", async () => {
    const { app, routes } = build({ mfaVerified: false });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("mfa_required");
    expect(routes.listProviders).not.toHaveBeenCalled();
    await app.close();
  });

  it("lets a read-only role read but not switch a provider off", async () => {
    const { app, routes } = build({ roles: ["support"], permissions: ["catalog.read"] });

    const read = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN });
    const write = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/providers/${PROVIDER.id}`,
      headers: AS_ADMIN,
      payload: { isActive: false },
    });

    expect(read.statusCode).toBe(200);
    expect(write.statusCode).toBe(403);
    // Deactivating a provider stops every job routed to it. Reading which
    // providers exist is a much smaller thing than that.
    expect(routes.updateProvider).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a write role that lacks catalog.write on the route list too", async () => {
    const { app, routes } = build({ roles: ["support"], permissions: ["invites.*"] });

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: { routes: [] },
    });

    expect(response.statusCode).toBe(403);
    expect(routes.replaceRoutes).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("listing providers", () => {
  it("reports the secret_ref name and whether it is set, never the value", async () => {
    const { app } = build(ADMIN, { WAVESPEED_API_KEY: "ws-live-abc123" });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN });
    const body = response.body;

    expect(response.json().providers[0].credentials[0]).toMatchObject({
      secretRef: "WAVESPEED_API_KEY",
      configured: true,
    });
    // The assertion that matters. A staff read permission must never be a way
    // to walk off with a provider account.
    expect(body).not.toContain("ws-live-abc123");
    await app.close();
  });

  it("says a key is not configured when it is unset or blank", async () => {
    for (const secrets of [{}, { WAVESPEED_API_KEY: "   " }]) {
      const { app } = build(ADMIN, secrets);
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN });
      // This is what separates "nobody set the key" from "the provider is
      // down" — the two reasons a newly routed model fails, which look
      // identical from a refund.
      expect(response.json().providers[0].credentials[0].configured).toBe(false);
      await app.close();
    }
  });

  it("says whether an adapter exists for the provider's code", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/providers", headers: AS_ADMIN });
    // Asked of the real factory, so a provider row cannot claim an adapter that
    // was deleted. wavespeed has one; a made-up code would not.
    expect(response.json().providers[0].hasAdapter).toBe(true);
    await app.close();
  });
});

describe("changing where a model runs", () => {
  it("replaces the route list and reports what it wrote", async () => {
    const { app, routes } = build();

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: { routes: [{ servingModelId: SERVING_MODEL_ID, priority: 0, isActive: true }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().routes[0]).toMatchObject({ isActive: true, priority: 0 });
    expect(routes.replaceRoutes).toHaveBeenCalledWith(
      CATALOG_MODEL_ID,
      [{ servingModelId: SERVING_MODEL_ID, priority: 0, isActive: true, paramOverrides: {} }],
      "u-admin",
    );
    await app.close();
  });

  it("audits the change with both sides in full", async () => {
    const { app, admin } = build();

    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: { routes: [{ servingModelId: SERVING_MODEL_ID, priority: 0, isActive: true }] },
    });

    // "Which provider was this running on last Tuesday" is a question a refund
    // argument turns on, and the route rows only ever hold the current answer.
    expect(admin.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "model_route.replaced",
        targetId: CATALOG_MODEL_ID,
        before: [expect.objectContaining({ isActive: false })],
        after: [expect.objectContaining({ isActive: true })],
      }),
    );
    await app.close();
  });

  it("refuses two active routes on one priority", async () => {
    const { app, routes } = build();

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: {
        routes: [
          { servingModelId: SERVING_MODEL_ID, priority: 0, isActive: true },
          { servingModelId: "66666666-6666-4666-8666-666666666666", priority: 0, isActive: true },
        ],
      },
    });

    // Caught before the database so the message says what is wrong rather than
    // surfacing an index name. "Lowest priority wins" is only an answer if the
    // lowest is unique.
    expect(response.statusCode).toBe(400);
    expect(routes.replaceRoutes).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses the same serving model twice", async () => {
    const { app } = build();

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: {
        routes: [
          { servingModelId: SERVING_MODEL_ID, priority: 0, isActive: true },
          { servingModelId: SERVING_MODEL_ID, priority: 1, isActive: false },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("defaults a route to inactive when nobody says otherwise", async () => {
    const { app, routes } = build();

    await app.inject({
      method: "PUT",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
      payload: { routes: [{ servingModelId: SERVING_MODEL_ID, priority: 5 }] },
    });

    // Adding a route is not the same act as switching traffic onto it, and the
    // safe direction for a forgotten field is off.
    expect(routes.replaceRoutes.mock.calls[0]![1]![0]!.isActive).toBe(false);
    await app.close();
  });

  it("clearing the routes sends the variant home", async () => {
    const { app, routes, admin } = build();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/routes`,
      headers: AS_ADMIN,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().routes).toEqual([]);
    expect(routes.replaceRoutes).toHaveBeenCalledWith(CATALOG_MODEL_ID, [], "u-admin");
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "model_route.cleared" }));
    await app.close();
  });
});

describe("listing models", () => {
  it("returns the catalogue and everywhere it could be sent", async () => {
    const { app } = build();

    const body = (await app.inject({ method: "GET", url: "/api/v1/admin/models", headers: AS_ADMIN })).json();

    expect(body.models[0]).toMatchObject({ variantId: "qwen-image", servingProviderCode: "kie", activeRouteCount: 0 });
    expect(body.servingModels[0]).toMatchObject({ providerCode: "wavespeed" });
    await app.close();
  });
});

/**
 * The three writes that turned routing from "arrange the four rows a seeder
 * wrote" into "send anything anywhere".
 *
 * The gate and the audit trail are the same ones the rest of this file covers,
 * so what is asserted here is what is specific to these: that the secret still
 * does not cross the boundary when a provider is created, that a duplicate is a
 * 409 rather than a 500, and that the one-click move is audited with both sides
 * — "which provider was this on last Tuesday" is a question a refund argument
 * turns on, and the route rows only ever hold the current answer.
 */
describe("adding providers and destinations", () => {
  it("creates a provider and answers with the key's NAME, never a value", async () => {
    const { app, routes, admin } = build(ADMIN, { NEW_PROVIDER_API_KEY: "sk-live-do-not-leak" });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/providers",
      headers: AS_ADMIN,
      payload: { code: "newprov", name: "New Provider", secretRef: "NEW_PROVIDER_API_KEY" },
    });

    expect(response.statusCode).toBe(201);
    expect(routes.createProvider).toHaveBeenCalled();
    // The whole body, not just the credential: a value that reached any field
    // here would be a read permission turned into a provider account.
    expect(response.body).not.toContain("sk-live-do-not-leak");
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "provider.created" }));
    await app.close();
  });

  it("refuses a key named for the browser bundle", async () => {
    const { app, routes } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/providers",
      headers: AS_ADMIN,
      // Next inlines this prefix into the client at build time and the
      // repository is public, so such a key would be published, not leaked.
      payload: { code: "newprov", name: "New Provider", secretRef: "NEXT_PUBLIC_NEW_PROVIDER_API_KEY" },
    });

    expect(response.statusCode).toBe(400);
    expect(routes.createProvider).not.toHaveBeenCalled();
    await app.close();
  });

  it("turns a duplicate into a 409 rather than an unhandled failure", async () => {
    const { app, routes } = build();
    const { ConflictError } = await import("@vgen/db");
    routes.createProvider.mockRejectedValueOnce(new ConflictError('A provider with code "kie" already exists'));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/providers",
      headers: AS_ADMIN,
      payload: { code: "kie", name: "Duplicate", secretRef: "KIE_API_KEY" },
    });

    // A panel can tell "you already made that" apart from "the database is
    // down" only if these are different codes.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("conflict");
    await app.close();
  });

  it("creates a destination without letting the caller make it a product", async () => {
    const { app, routes } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/serving-models",
      headers: AS_ADMIN,
      // `capabilities` is not in the schema, and .strict() means naming it is
      // an error rather than a field that is quietly dropped.
      payload: {
        providerId: PROVIDER.id,
        externalModelId: "wavespeed-ai/wan-2.7/text-to-video",
        name: "WAN 2.7",
        modality: "video",
        capabilities: { variant: { id: "smuggled" } },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(routes.createServingModel).not.toHaveBeenCalled();
    await app.close();
  });

  it("needs catalog.write to add a destination, not merely catalog.read", async () => {
    const { app, routes } = build({ roles: ["support"], permissions: ["catalog.read"] });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/serving-models",
      headers: AS_ADMIN,
      payload: { providerId: PROVIDER.id, externalModelId: "alt/model", name: "Alt", modality: "image" },
    });

    expect(response.statusCode).toBe(403);
    expect(routes.createServingModel).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("moving a model in one request", () => {
  it("switches the route and audits both sides of the change", async () => {
    const { app, routes, admin } = build();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/route-to`,
      headers: AS_ADMIN,
      payload: { servingModelId: SERVING_MODEL_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(routes.routeTo).toHaveBeenCalledWith(CATALOG_MODEL_ID, SERVING_MODEL_ID, "u-admin");
    expect(response.json().routes[0].isActive).toBe(true);
    expect(admin.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "model_route.switched",
        // Both sides in full: the rows themselves only hold the current answer.
        before: expect.any(Array),
        after: expect.any(Array),
      }),
    );
    await app.close();
  });

  it("will not take a priority, so two admins cannot race over one", async () => {
    const { app, routes } = build();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/route-to`,
      headers: AS_ADMIN,
      payload: { servingModelId: SERVING_MODEL_ID, priority: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(routes.routeTo).not.toHaveBeenCalled();
    await app.close();
  });

  it("answers 404 for a variant that is not in the catalogue", async () => {
    const { app, routes } = build();
    const { UnknownModelError } = await import("@vgen/db");
    routes.routeTo.mockRejectedValueOnce(new UnknownModelError("No catalogue variant with that id"));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/route-to`,
      headers: AS_ADMIN,
      payload: { servingModelId: SERVING_MODEL_ID },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("needs catalog.write, since it moves production traffic", async () => {
    const { app, routes } = build({ roles: ["support"], permissions: ["catalog.read"] });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/models/${CATALOG_MODEL_ID}/route-to`,
      headers: AS_ADMIN,
      payload: { servingModelId: SERVING_MODEL_ID },
    });

    expect(response.statusCode).toBe(403);
    expect(routes.routeTo).not.toHaveBeenCalled();
    await app.close();
  });
});
