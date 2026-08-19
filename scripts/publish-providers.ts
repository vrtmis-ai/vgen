/**
 * Seed the second provider, its rates, and where a variant *could* run.
 *
 * Three tables and one rule between them: **nothing this writes changes what
 * any customer gets.** The serving models it creates carry no `variant` key, so
 * `PostgresCatalogRepository` never puts them in the shop; the routes it writes
 * are inactive, so `claim()` falls through them to the catalogue row exactly as
 * it did before this script existed. Turning one on is a person's decision made
 * through the admin API, and it is the only thing that changes behaviour.
 *
 * Idempotent by construction, like `publish-catalog.ts` and for the same
 * reason: `provider_models` has an updated_at trigger and the served catalog
 * version is derived from it, so an unconditional upsert would hand every
 * customer a new catalog version every time this ran.
 *
 * The rates are effective-dated rather than overwritten. A price that changes
 * closes the old row and opens a new one, so a job settled last month can still
 * say what its provider cost us at the time — the difference between a ledger
 * and a guess.
 *
 * Run: pnpm providers:publish   (needs DATABASE_URL)
 */
import { config } from "dotenv";
import postgres from "postgres";
import seed from "../src/data/routes.wavespeed.json" with { type: "json" };

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish providers");

interface SeedRoute {
  variantId: string;
  externalModelId: string;
  modality: string;
  name: string;
  priority: number;
  note: string;
  paramOverrides: Record<string, unknown>;
}

const sql = postgres(databaseUrl, { max: 1 });

/** The `$comment` keys are documentation for a human and must not reach the database. */
function withoutComments(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("$")));
}

try {
  const summary = await sql.begin(async (tx) => {
    const written = { providers: 0, credentials: 0, rates: 0, models: 0, routes: 0 };

    // ---------------------------------------------------------- the provider
    const [provider] = await tx<{ id: string }[]>`
      insert into providers (code, name, base_url, credit_unit_name, is_active)
      values (${seed.provider.code}, ${seed.provider.name}, ${seed.provider.baseUrl}, ${seed.provider.creditUnitName}, true)
      on conflict (code) do update set
        name = excluded.name,
        base_url = excluded.base_url,
        credit_unit_name = excluded.credit_unit_name,
        is_active = true
      where
        providers.name is distinct from excluded.name
        or providers.base_url is distinct from excluded.base_url
        or providers.credit_unit_name is distinct from excluded.credit_unit_name
        or providers.is_active is distinct from true
      returning id
    `;
    if (provider) written.providers++;
    const providerId = provider?.id ?? (await tx<{ id: string }[]>`select id from providers where code = ${seed.provider.code}`)[0]?.id;
    if (!providerId) throw new Error("provider upsert lost the wavespeed row");

    // The key the worker calls with. `secret_ref` is the NAME of an environment
    // variable, never the key — the table's own comment asks for this, because
    // a leaked database dump must not be a leaked provider account.
    const [credential] = await tx<{ id: string }[]>`
      insert into provider_credentials (provider_id, label, secret_ref, is_active)
      values (${providerId}, 'wavespeed-primary', ${seed.provider.secretRef}, true)
      on conflict (provider_id, label) do update set
        secret_ref = excluded.secret_ref,
        is_active = true
      where
        provider_credentials.secret_ref is distinct from excluded.secret_ref
        or provider_credentials.is_active is distinct from true
      returning id
    `;
    if (credential) written.credentials++;

    // ------------------------------------------------------------ unit rates
    for (const rate of seed.rates) {
      const [target] = await tx<{ id: string }[]>`select id from providers where code = ${rate.providerCode}`;
      // A rate for a provider that is not seeded yet is not an error worth
      // stopping for — `kie` arrives with publish-catalog, and the two scripts
      // do not have to run in one order.
      if (!target) continue;

      const [live] = await tx<{ id: string; provider_unit_cost_usd: string }[]>`
        select id, provider_unit_cost_usd from provider_credit_rates
        where provider_id = ${target.id} and valid_to is null
        order by valid_from desc limit 1
      `;
      if (live && Number(live.provider_unit_cost_usd) === rate.unitCostUsd) continue;

      // Closed, then reopened. Overwriting would rewrite what past jobs cost.
      if (live) await tx`update provider_credit_rates set valid_to = now() where id = ${live.id}`;
      await tx`
        insert into provider_credit_rates (provider_id, provider_unit_cost_usd, micro_credits_per_unit, note)
        values (${target.id}, ${rate.unitCostUsd}, 0, ${rate.note})
      `;
      written.rates++;
    }

    // -------------------------------------------------- serving models + routes
    const routes = seed.routes as unknown as SeedRoute[];
    for (const route of routes) {
      const [catalogModel] = await tx<{ id: string }[]>`
        select id from provider_models
        where capabilities -> 'variant' ->> 'id' = ${route.variantId} and capabilities ? 'variant'
        limit 1
      `;
      if (!catalogModel) {
        throw new Error(`no catalogue variant "${route.variantId}" — run pnpm catalog:publish first`);
      }

      // No `variant` key in capabilities, and that absence is the whole
      // contract: it is what keeps this row out of the shop while leaving it
      // routable, priceable and joinable like any other model.
      const [servingModel] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities, is_active)
        values (${providerId}, ${route.externalModelId}, ${route.name}, ${route.modality}, '{}'::jsonb, true)
        on conflict (provider_id, external_model_id) do update set
          name = excluded.name,
          modality = excluded.modality,
          is_active = true,
          deprecated_at = null
        where
          provider_models.name is distinct from excluded.name
          or provider_models.modality is distinct from excluded.modality
          or provider_models.is_active is distinct from true
        returning id
      `;
      if (servingModel) written.models++;
      const servingModelId =
        servingModel?.id ??
        (
          await tx<{ id: string }[]>`
            select id from provider_models where provider_id = ${providerId} and external_model_id = ${route.externalModelId}
          `
        )[0]?.id;
      if (!servingModelId) throw new Error(`provider_models upsert lost ${route.externalModelId}`);

      const overrides = withoutComments(route.paramOverrides);
      // `is_active` is deliberately absent from the update list. Re-running the
      // seeder must never switch a route back on that somebody turned off, and
      // must never switch one on that nobody has verified.
      const [written_route] = await tx<{ id: string }[]>`
        insert into model_routes (catalog_model_id, serving_model_id, priority, is_active, param_overrides, note)
        values (
          ${catalogModel.id}, ${servingModelId}, ${route.priority}, false,
          ${tx.json(overrides as never)}, ${route.note}
        )
        on conflict (catalog_model_id, serving_model_id) do update set
          priority = excluded.priority,
          param_overrides = excluded.param_overrides,
          note = excluded.note
        where
          model_routes.priority is distinct from excluded.priority
          or model_routes.param_overrides is distinct from excluded.param_overrides
          or model_routes.note is distinct from excluded.note
        returning id
      `;
      if (written_route) written.routes++;
    }

    return written;
  });

  const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    console.log("providers already current, nothing written");
  } else {
    console.log(
      `wrote ${summary.providers} provider, ${summary.credentials} credential, ${summary.rates} rate, ` +
        `${summary.models} serving model and ${summary.routes} route rows`,
    );
  }
  console.log("every route is inactive. Run scripts/spike-wavespeed.ts with a real key before activating any of them.");
} finally {
  await sql.end();
}
