import {
  AdminProviderCreateSchema,
  AdminProviderPatchSchema,
  AdminRoutesPutSchema,
  AdminRouteToSchema,
  AdminServingModelCreateSchema,
  type AdminCatalogModel,
  type AdminProvider,
  type AdminRoute,
  type AdminServingModel,
} from "@vgen/contracts";
import { createGenerationProvider } from "@vgen/adapters";
import { ConflictError, UnknownModelError, type PostgresModelRoutesRepository, type ProviderSummary, type RouteRecord } from "@vgen/db";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AdminGuard } from "./admin";

/**
 * Staff routes for providers and where a catalogue variant actually runs.
 *
 * The thing these exist to make possible: moving a model from one provider to
 * another without a deploy. Before this, "Seedream runs on KIE" was a fact
 * encoded in which `provider_models` row happened to carry the presentation
 * JSON, and changing it meant editing rows that prices and past jobs point at.
 *
 * Two properties are held here and both are easy to lose in a refactor:
 *
 *   1. **Secrets never cross this boundary.** `secret_ref` is an environment
 *      variable's *name*, and `configured` is the only thing derived from its
 *      value. Returning the value would turn a read-only staff permission into
 *      a way to walk off with every provider account we have.
 *   2. **Every mutation is audited before it answers**, through the same helper
 *      the invite and promo routes use. `audit_log` is append-only at the
 *      database, so a routing change that costs money cannot be tidied away
 *      afterwards by whoever made it.
 */

export interface AdminCatalogDependencies {
  routes: PostgresModelRoutesRepository;
  /** Where `secret_ref` names are resolved. `process.env` in production. */
  secrets: Record<string, string | undefined>;
}

function toProvider(provider: ProviderSummary, secrets: Record<string, string | undefined>): AdminProvider {
  return {
    id: provider.id,
    code: provider.code,
    name: provider.name,
    baseUrl: provider.baseUrl,
    isActive: provider.isActive,
    // Asked of the factory rather than kept as a list here, so a provider row
    // can never claim an adapter that was deleted.
    hasAdapter: createGenerationProvider(provider.code) !== null,
    unitCostUsd: provider.unitCostUsd,
    credentials: provider.credentials.map((credential) => ({
      id: credential.id,
      label: credential.label,
      secretRef: credential.secretRef,
      // The whole value of this field is that it distinguishes "nobody set the
      // key" from "the provider is down", which are the two things a newly
      // routed model fails for and which look identical from a refund.
      configured: (secrets[credential.secretRef] ?? "").trim() !== "",
      isActive: credential.isActive,
      dailyRequestCap: credential.dailyRequestCap,
      lastUsedAt: credential.lastUsedAt,
    })),
  };
}

/**
 * Turns the repository's two refusals into the two status codes that mean
 * them.
 *
 * Without this they arrive as a 500, and a panel cannot tell "you have already
 * created that" apart from "the database is down" — which are the two things an
 * admin most needs distinguished when a form will not submit.
 */
function refuse(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ConflictError) return reply.code(409).send({ error: { code: "conflict", message: error.message } });
  if (error instanceof UnknownModelError) return reply.code(404).send({ error: { code: "not_found", message: error.message } });
  throw error;
}

const toRoute = (route: RouteRecord): AdminRoute => ({
  id: route.id,
  servingModelId: route.servingModelId,
  providerCode: route.providerCode,
  externalModelId: route.externalModelId,
  priority: route.priority,
  isActive: route.isActive,
  paramOverrides: route.paramOverrides,
  note: route.note,
});

export function registerAdminCatalogRoutes(app: FastifyInstance, dependencies: AdminCatalogDependencies, guard: AdminGuard): void {
  const { routes, secrets } = dependencies;
  const { require, audit } = guard;

  // ------------------------------------------------------------- providers

  app.get("/api/v1/admin/providers", async (request, reply) => {
    const session = await require(request, reply, "catalog.read");
    if (!session) return reply;
    const providers = await routes.listProviders();
    return reply.send({ providers: providers.map((provider) => toProvider(provider, secrets)) });
  });

  /**
   * Add a provider.
   *
   * Answers with `hasAdapter: false` and every credential `configured: false`,
   * which is not a failure — it is the true state of a provider nobody has
   * written an adapter for and no deploy has given a key to. The panel shows
   * both in red so the two remaining steps are visible rather than discovered
   * later from a refunded job.
   *
   * `secretRef` is validated against `SecretRefSchema`, which refuses anything
   * beginning `NEXT_PUBLIC_`. That prefix is inlined into the browser bundle at
   * build time and this repository is public, so a key named that way would be
   * published rather than leaked.
   */
  app.post("/api/v1/admin/providers", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const body = AdminProviderCreateSchema.parse(request.body);

    let created: ProviderSummary;
    try {
      created = await routes.createProvider(body, session.userId);
    } catch (error) {
      return refuse(reply, error);
    }

    await audit(request, session, {
      action: "provider.created",
      targetType: "provider",
      targetId: created.id,
      after: { code: created.code, name: created.name, baseUrl: created.baseUrl, secretRef: body.secretRef },
    });
    return reply.code(201).send({ provider: toProvider(created, secrets) });
  });

  app.patch("/api/v1/admin/providers/:id", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    const body = AdminProviderPatchSchema.parse(request.body);

    const before = await routes.getProvider(id);
    if (!before) return reply.code(404).send({ error: { code: "not_found", message: "No such provider." } });

    const after = await routes.updateProvider(id, body);
    await audit(request, session, {
      action: "provider.updated",
      targetType: "provider",
      targetId: id,
      before: { isActive: before.isActive, baseUrl: before.baseUrl, name: before.name },
      after: { isActive: after!.isActive, baseUrl: after!.baseUrl, name: after!.name },
    });
    return reply.send({ provider: toProvider(after!, secrets) });
  });

  // ---------------------------------------------------------------- models

  app.get("/api/v1/admin/models", async (request, reply) => {
    const session = await require(request, reply, "catalog.read");
    if (!session) return reply;
    const [models, servingModels] = await Promise.all([routes.listCatalogModels(), routes.listServingModels()]);
    return reply.send({
      models: models satisfies AdminCatalogModel[],
      servingModels: servingModels satisfies AdminServingModel[],
    });
  });

  /**
   * Add somewhere a variant can be sent.
   *
   * Until this existed the panel could only route to rows a seeder had written
   * — four of them, from `routes.wavespeed.json` — so "run this on WaveSpeed
   * instead" was answerable for four models out of forty-four and required
   * editing JSON and re-running a script for the rest.
   *
   * The row is created with no `capabilities`, and this endpoint cannot set
   * them. A `provider_models` row carrying a `variant` key is a thing in the
   * shop; a destination that could carry one would be a destination a customer
   * could buy.
   */
  app.post("/api/v1/admin/serving-models", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const body = AdminServingModelCreateSchema.parse(request.body);

    let created: AdminServingModel;
    try {
      created = await routes.createServingModel(body);
    } catch (error) {
      return refuse(reply, error);
    }

    await audit(request, session, {
      action: "serving_model.created",
      targetType: "provider_model",
      targetId: created.id,
      after: { providerCode: created.providerCode, externalModelId: created.externalModelId, modality: created.modality },
    });
    return reply.code(201).send({ servingModel: created });
  });

  app.get("/api/v1/admin/models/:id/routes", async (request, reply) => {
    const session = await require(request, reply, "catalog.read");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    return reply.send({ routes: (await routes.listRoutes(id)).map(toRoute) });
  });

  /**
   * The switch.
   *
   * Replaces the whole list rather than patching one row, because the partial
   * unique index on `(catalog_model_id, priority) where is_active` means
   * swapping two priorities one statement at a time collides on the value that
   * is only transiently taken.
   */
  app.put("/api/v1/admin/models/:id/routes", { bodyLimit: 32 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    const body = AdminRoutesPutSchema.parse(request.body);

    const before = await routes.listRoutes(id);
    let after: RouteRecord[];
    try {
      after = await routes.replaceRoutes(
        id,
        body.routes.map((route) => ({
          servingModelId: route.servingModelId,
          priority: route.priority,
          isActive: route.isActive,
          paramOverrides: route.paramOverrides,
          ...(route.note === undefined ? {} : { note: route.note }),
        })),
        session.userId,
      );
    } catch (error) {
      if (error instanceof UnknownModelError) {
        return reply.code(404).send({ error: { code: "not_found", message: error.message } });
      }
      throw error;
    }

    // Audited with both sides in full. "Which provider was this running on last
    // Tuesday" is a question a refund argument turns on, and the route rows
    // themselves only ever hold the current answer.
    await audit(request, session, {
      action: "model_route.replaced",
      targetType: "provider_model",
      targetId: id,
      before: before.map(toRoute),
      after: after.map(toRoute),
    });
    return reply.send({ routes: after.map(toRoute) });
  });

  /**
   * The one-click move: run this variant here, starting now.
   *
   * A route of its own rather than something the browser assembles out of `PUT
   * /routes`, because "make this the winner" is a read-then-write. Two admins
   * doing it at once from a browser would each compute a priority against a
   * list that changed underneath them; done in one transaction there is no such
   * window.
   *
   * It is also the only mutation here that a person will reach for while
   * something is going wrong — a provider is failing and the model needs to be
   * somewhere else — so it deliberately takes one field and decides the rest.
   */
  app.post("/api/v1/admin/models/:id/route-to", { bodyLimit: 1024 }, async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    const body = AdminRouteToSchema.parse(request.body);

    const before = await routes.listRoutes(id);
    let after: RouteRecord[];
    try {
      after = await routes.routeTo(id, body.servingModelId, session.userId);
    } catch (error) {
      return refuse(reply, error);
    }

    await audit(request, session, {
      action: "model_route.switched",
      targetType: "provider_model",
      targetId: id,
      before: before.map(toRoute),
      after: after.map(toRoute),
    });
    return reply.send({ routes: after.map(toRoute) });
  });

  app.delete("/api/v1/admin/models/:id/routes", async (request, reply) => {
    const session = await require(request, reply, "catalog.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };

    const before = await routes.listRoutes(id);
    try {
      await routes.replaceRoutes(id, [], session.userId);
    } catch (error) {
      if (error instanceof UnknownModelError) {
        return reply.code(404).send({ error: { code: "not_found", message: error.message } });
      }
      throw error;
    }

    // Not "delete the model" — clearing every route sends the variant back to
    // the provider that owns its catalogue row, which is where it started.
    await audit(request, session, {
      action: "model_route.cleared",
      targetType: "provider_model",
      targetId: id,
      before: before.map(toRoute),
      after: [],
    });
    return reply.send({ routes: [] });
  });
}
