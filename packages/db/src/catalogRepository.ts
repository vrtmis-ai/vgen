import { CatalogCapabilitiesSchema, CatalogSnapshotSchema, type CatalogFamily, type CatalogSnapshot } from "@vgen/contracts";
import type { Sql } from "postgres";

export interface CustomerCatalogRepository {
  list(): Promise<CatalogSnapshot>;
}

/**
 * The catalog, rebuilt from the tables the rest of the schema routes and prices
 * through.
 *
 * It used to read one JSON document per family out of `models`, an app-only
 * table that nothing else could join to — so a job's provider_model_id and the
 * catalog the customer chose from were two unrelated facts. Now a family is a
 * group of `provider_models` rows sharing a `family` value, which is the same
 * row `feature_model_routes` routes to and `model_prices` prices.
 *
 * The shape the browser receives is unchanged. That is the point: fifteen
 * screens read this snapshot and none of them had to know the storage moved.
 */
export class PostgresCatalogRepository implements CustomerCatalogRepository {
  constructor(private readonly sql: Sql) {}

  async list(): Promise<CatalogSnapshot> {
    const rows = await this.sql<{ family: string; capabilities: unknown; updated_at: Date }[]>`
      select model.family, model.capabilities, model.updated_at
      from provider_models model
      join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active
        -- A provider_models row without presentation is a way to run something,
        -- not something to offer. The same logical model reached through a
        -- second provider — a Nano Banana served free by a subscription
        -- account rather than metered by KIE — is genuinely a second row here,
        -- because routing, attempts and health are all per provider. But it is
        -- not a second entry in the shop, and without this guard it would
        -- render as a duplicate variant the customer could pick the wrong one
        -- of. A 'variant' key in capabilities is what makes a row a catalog entry.
        and model.capabilities ? 'variant'
      order by
        (model.capabilities ->> 'familyOrder')::int asc,
        (model.capabilities ->> 'variantOrder')::int asc
    `;
    if (rows.length === 0) return CatalogSnapshotSchema.parse({ version: "bootstrap-v1", publishedAt: 0, families: [] });

    // Insertion order carries the sort out of the query above, so the families
    // and their variants come back in the order the screens present them.
    const families = new Map<string, CatalogFamily>();
    let newest = 0;

    for (const row of rows) {
      const { family, variant } = CatalogCapabilitiesSchema.parse(row.capabilities);
      newest = Math.max(newest, row.updated_at.getTime());

      const existing = families.get(row.family);
      if (existing) existing.variants.push(variant);
      else families.set(row.family, { ...family, variants: [variant] });
    }

    // Derived rather than stored: `provider_models` has an updated_at trigger,
    // so the newest row is the moment this catalog last changed. That is what a
    // version is for — a client holding an older one knows it is stale — and it
    // means publishing is a write to the models, not to a second version table
    // that could disagree with them.
    return CatalogSnapshotSchema.parse({
      version: `catalog-${newest}`,
      publishedAt: newest,
      families: [...families.values()],
    });
  }
}
