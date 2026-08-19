import type { ParamOverrides } from "@vgen/core";
import type { Sql } from "postgres";
import type { Modality } from "./jobRunnerRepository";
import { atomically } from "./transaction";

/**
 * Reading and rewriting where a catalogue variant actually runs.
 *
 * The one thing worth holding onto while changing this file: **`effectiveServing`
 * below and the `coalesce` in `jobRunnerRepository.claim()` must agree.** The
 * panel shows an admin what a model is running on; the claim decides what it
 * actually runs on. If those two ever compute it differently, the panel becomes
 * a lie about money — someone reads "WaveSpeed" and is billed by KIE.
 *
 * They are written as the same query twice rather than shared, because the
 * claim's version is inside a data-modifying CTE that has to stay one round
 * trip. The duplication is deliberate and the integration test asserts they
 * match on the cases that differ (inactive route, deactivated provider, grant).
 */

export interface PooledCredentialSummary {
  id: string;
  label: string;
  /** The environment variable's name. The value is never read here. */
  secretRef: string;
  isActive: boolean;
  dailyRequestCap: number | null;
  lastUsedAt: number | null;
}

export interface ProviderSummary {
  id: string;
  code: string;
  name: string;
  baseUrl: string | null;
  isActive: boolean;
  unitCostUsd: number | null;
  credentials: PooledCredentialSummary[];
}

export interface ServingModelSummary {
  id: string;
  providerId: string;
  providerCode: string;
  externalModelId: string;
  name: string;
  modality: Modality;
  isActive: boolean;
}

export interface CatalogModelSummary {
  id: string;
  variantId: string;
  familyId: string | null;
  name: string;
  modality: Modality;
  isActive: boolean;
  homeProviderCode: string;
  homeExternalModelId: string;
  servingProviderCode: string;
  servingExternalModelId: string;
  routeCount: number;
  activeRouteCount: number;
}

export interface RouteRecord {
  id: string;
  servingModelId: string;
  providerCode: string;
  externalModelId: string;
  priority: number;
  isActive: boolean;
  paramOverrides: ParamOverrides;
  note: string | null;
}

export interface RouteInput {
  servingModelId: string;
  priority: number;
  isActive: boolean;
  paramOverrides: ParamOverrides;
  note?: string | undefined;
}

export class UnknownModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownModelError";
  }
}

export class PostgresModelRoutesRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Every provider, with its credential pool.
   *
   * `secret_ref` is returned; the secret is not, and cannot be — the column has
   * only ever held the name of an environment variable. Whether that variable
   * is set is decided by the caller, which is the process that would have to
   * read it.
   */
  async listProviders(): Promise<ProviderSummary[]> {
    const rows = await this.sql<
      {
        id: string;
        code: string;
        name: string;
        base_url: string | null;
        is_active: boolean;
        unit_cost_usd: string | null;
        credentials: PooledCredentialSummary[] | null;
      }[]
    >`
      select
        p.id, p.code, p.name, p.base_url, p.is_active,
        rate.provider_unit_cost_usd as unit_cost_usd,
        (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', c.id, 'label', c.label, 'secretRef', c.secret_ref,
                'isActive', c.is_active, 'dailyRequestCap', c.daily_request_cap,
                'lastUsedAt', (extract(epoch from c.last_used_at) * 1000)::bigint
              ) order by c.label
            ),
            '[]'::jsonb
          )
          from provider_credentials c where c.provider_id = p.id
        ) as credentials
      from providers p
      left join lateral (
        select pcr.provider_unit_cost_usd
        from provider_credit_rates pcr
        where pcr.provider_id = p.id
          and pcr.valid_from <= now()
          and (pcr.valid_to is null or pcr.valid_to > now())
        order by pcr.valid_from desc
        limit 1
      ) rate on true
      order by p.code
    `;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      baseUrl: row.base_url,
      isActive: row.is_active,
      unitCostUsd: row.unit_cost_usd === null ? null : Number(row.unit_cost_usd),
      credentials: (row.credentials ?? []).map((credential) => ({
        ...credential,
        lastUsedAt: credential.lastUsedAt === null ? null : Number(credential.lastUsedAt),
      })),
    }));
  }

  async getProvider(id: string): Promise<ProviderSummary | null> {
    return (await this.listProviders()).find((provider) => provider.id === id) ?? null;
  }

  async updateProvider(
    id: string,
    patch: { isActive?: boolean | undefined; baseUrl?: string | null | undefined },
  ): Promise<ProviderSummary | null> {
    const [row] = await this.sql<{ id: string }[]>`
      update providers set
        is_active = ${patch.isActive ?? this.sql`is_active`},
        base_url  = ${patch.baseUrl === undefined ? this.sql`base_url` : patch.baseUrl}
      where id = ${id}
      returning id
    `;
    return row ? this.getProvider(id) : null;
  }

  /**
   * The catalogue, with where each entry is actually being sent.
   *
   * A catalogue row is one carrying `capabilities -> 'variant'`, which is the
   * same test `PostgresCatalogRepository` uses to decide what is in the shop. A
   * row without that key is a way to run something, not something to sell, and
   * it shows up in `listServingModels` instead.
   */
  async listCatalogModels(): Promise<CatalogModelSummary[]> {
    const rows = await this.sql<
      {
        id: string;
        variant_id: string;
        family: string | null;
        name: string;
        modality: Modality;
        is_active: boolean;
        home_provider_code: string;
        home_external_model_id: string;
        serving_provider_code: string;
        serving_external_model_id: string;
        route_count: string;
        active_route_count: string;
      }[]
    >`
      select
        model.id,
        model.capabilities -> 'variant' ->> 'id' as variant_id,
        model.family, model.name, model.modality, model.is_active,
        home.code as home_provider_code,
        model.external_model_id as home_external_model_id,
        coalesce(serving_provider.code, home.code) as serving_provider_code,
        coalesce(serving.external_model_id, model.external_model_id) as serving_external_model_id,
        (select count(*) from model_routes r where r.catalog_model_id = model.id) as route_count,
        (select count(*) from model_routes r where r.catalog_model_id = model.id and r.is_active) as active_route_count
      from provider_models model
      join providers home on home.id = model.provider_id
      -- Same shape as the lateral in claim(), minus the entitlement branch: a
      -- grant is per-account, and this list is not about one account.
      left join lateral (
        select r.serving_model_id
        from model_routes r
        join provider_models sm on sm.id = r.serving_model_id
        join providers sp on sp.id = sm.provider_id
        where r.catalog_model_id = model.id
          and r.is_active and sm.is_active and sp.is_active
        order by r.priority asc
        limit 1
      ) route on true
      left join provider_models serving on serving.id = route.serving_model_id
      left join providers serving_provider on serving_provider.id = serving.provider_id
      where model.capabilities ? 'variant'
      order by model.family nulls last, model.name
    `;
    return rows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      familyId: row.family,
      name: row.name,
      modality: row.modality,
      isActive: row.is_active,
      homeProviderCode: row.home_provider_code,
      homeExternalModelId: row.home_external_model_id,
      servingProviderCode: row.serving_provider_code,
      servingExternalModelId: row.serving_external_model_id,
      routeCount: Number(row.route_count),
      activeRouteCount: Number(row.active_route_count),
    }));
  }

  /** Everywhere a variant could be routed: the rows that are not in the shop. */
  async listServingModels(): Promise<ServingModelSummary[]> {
    const rows = await this.sql<
      {
        id: string;
        provider_id: string;
        provider_code: string;
        external_model_id: string;
        name: string;
        modality: Modality;
        is_active: boolean;
      }[]
    >`
      select model.id, model.provider_id, provider.code as provider_code,
             model.external_model_id, model.name, model.modality, model.is_active
      from provider_models model
      join providers provider on provider.id = model.provider_id
      where not (model.capabilities ? 'variant')
      order by provider.code, model.external_model_id
    `;
    return rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      providerCode: row.provider_code,
      externalModelId: row.external_model_id,
      name: row.name,
      modality: row.modality,
      isActive: row.is_active,
    }));
  }

  async listRoutes(catalogModelId: string, sql: Sql = this.sql): Promise<RouteRecord[]> {
    const rows = await sql<
      {
        id: string;
        serving_model_id: string;
        provider_code: string;
        external_model_id: string;
        priority: number;
        is_active: boolean;
        param_overrides: ParamOverrides;
        note: string | null;
      }[]
    >`
      select r.id, r.serving_model_id, provider.code as provider_code,
             model.external_model_id, r.priority, r.is_active, r.param_overrides, r.note
      from model_routes r
      join provider_models model on model.id = r.serving_model_id
      join providers provider on provider.id = model.provider_id
      where r.catalog_model_id = ${catalogModelId}
      -- Inactive last: the list reads top-down as "what runs, then what could".
      order by r.is_active desc, r.priority asc
    `;
    return rows.map((row) => ({
      id: row.id,
      servingModelId: row.serving_model_id,
      providerCode: row.provider_code,
      externalModelId: row.external_model_id,
      priority: row.priority,
      isActive: row.is_active,
      paramOverrides: row.param_overrides,
      note: row.note,
    }));
  }

  /**
   * Replace every route for one catalogue variant, in one transaction.
   *
   * A whole-list replace rather than per-row edits, and that is not tidiness.
   * The partial unique index on `(catalog_model_id, priority) where is_active`
   * means swapping two routes' priorities one statement at a time collides on
   * the priority that is only transiently taken — the write fails halfway and
   * leaves a variant routed somewhere nobody chose. Deleting the set and
   * reinserting it inside one transaction never occupies an intermediate state
   * anyone else can observe.
   */
  async replaceRoutes(catalogModelId: string, routes: RouteInput[], actorUserId: string | null): Promise<RouteRecord[]> {
    return atomically(this.sql)(async (transaction) => {
      const tx = transaction as unknown as Sql;

      const [model] = await tx<{ id: string }[]>`
        select id from provider_models
        where id = ${catalogModelId} and capabilities ? 'variant'
        for update
      `;
      // Refused rather than created: routing *from* a serving row would build a
      // chain claim() does not follow, so the job would run somewhere the panel
      // never showed.
      if (!model) throw new UnknownModelError("No catalogue variant with that id");

      if (routes.length > 0) {
        const servingIds = routes.map((route) => route.servingModelId);
        const known = await tx<{ id: string }[]>`
          select id from provider_models where id = any(${servingIds}::uuid[])
        `;
        if (known.length !== new Set(servingIds).size) throw new UnknownModelError("A route names a model that does not exist");
        if (servingIds.includes(catalogModelId)) throw new UnknownModelError("A variant cannot be routed to itself");
      }

      await tx`delete from model_routes where catalog_model_id = ${catalogModelId}`;

      for (const route of routes) {
        await tx`
          insert into model_routes (catalog_model_id, serving_model_id, priority, is_active, param_overrides, note, created_by)
          values (
            ${catalogModelId}, ${route.servingModelId}, ${route.priority}, ${route.isActive},
            ${tx.json(route.paramOverrides as never)}, ${route.note ?? null}, ${actorUserId}
          )
        `;
      }

      return this.listRoutes(catalogModelId, tx);
    });
  }
}
