import { CatalogCapabilitiesSchema, CatalogSnapshotSchema, type CatalogFamily, type CatalogSnapshot } from "@vgen/contracts";
import type { Sql } from "postgres";
import { PublicDocument, fingerprintOf } from "./publicDocument";

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

  /**
   * Rebuilt only when something publishes. See `PublicDocument`.
   *
   * This one had the most to gain: forty-four rows, each with a `capabilities`
   * blob, each parsed through a discriminated union of controls and reference
   * slots, on every request. Both timestamps are read because switching off a
   * whole provider removes its models from the shop without touching
   * `provider_models` at all — the trigger is on that table and the write was
   * to `providers`.
   */
  private readonly document = new PublicDocument(
    async () => {
      const [row] = await this.sql<{ n: string; model: Date | null; provider: Date | null }[]>`
        select count(*)::text as n, max(model.updated_at) as model, max(provider.updated_at) as provider
        from provider_models model
        join providers provider on provider.id = model.provider_id
        where model.is_active and provider.is_active and model.capabilities ? 'variant'
      `;
      // The grants are part of this document, so they are part of its
      // fingerprint — and this query has to repeat `unlimitedByModel`'s joins
      // rather than just count the entitlement rows.
      //
      // A test found that out. Switching off the *serving* provider withdraws
      // every offer it backs, but it touches no `unlimited_entitlements` row
      // and no provider in the query above, which only sees providers that have
      // catalogue rows of their own — and a serving row deliberately has none.
      // So the count stayed 1, the fingerprint held, and the cached document
      // went on advertising a pipe that `findGrant` had already stopped
      // opening. Counting through the joins is what makes the row leave the
      // set, which is the class docblock's whole point about counting as well
      // as maximising.
      const [grants] = await this.sql<{ n: string; changed: Date | null }[]>`
        select count(*)::text as n,
               greatest(max(ent.updated_at), max(serving.updated_at), max(provider.updated_at)) as changed
        from unlimited_entitlements ent
        join provider_models serving on serving.id = ent.serving_model_id
        join providers provider on provider.id = serving.provider_id
        where ent.is_active and serving.is_active and provider.is_active
      `;
      // Two counts in the one slot the helper takes: the document changes if
      // either set gains or loses a row, and joining them keeps that a single
      // comparable string rather than a second fingerprint to reconcile.
      return fingerprintOf(`${row?.n ?? "0"}+${grants?.n ?? "0"}`, row?.model, row?.provider, grants?.changed);
    },
    () => this.build(),
  );

  async list(): Promise<CatalogSnapshot> {
    return this.document.get();
  }

  /**
   * The live grants, by the catalogue row each one makes free.
   *
   * The conditions are deliberately the same four `findGrant` applies at quote
   * time — active grant, active serving model, active provider — because the
   * two answers have to agree. A shop advertising a pipe the quote declines to
   * open is worse than one that never mentioned it: the customer chooses the
   * model *for* the free pipe and then pays for it.
   *
   * `min_tier` and `daily_cap` are published without knowing who is asking.
   * That is deliberate and it is the same contract a price has: this is what
   * the offer *is*, not what you personally get. What you get needs your plan
   * and today's spend, and it comes back on the quote. The catalogue document
   * is one shared object for every visitor including anonymous ones, so it
   * could not be per-account even if that were wanted.
   */
  private async unlimitedByModel(): Promise<
    Map<string, { dailyCap: number | null; minTier: 1 | 2 | 3; limits?: Record<string, string[]> }>
  > {
    const rows = await this.sql<
      { catalog_model_id: string; daily_cap: number | null; min_tier: number; covers: Record<string, string[]> | null }[]
    >`
      select ent.catalog_model_id, ent.daily_cap, ent.min_tier, ent.covers
      from unlimited_entitlements ent
      join provider_models serving on serving.id = ent.serving_model_id
      join providers provider on provider.id = serving.provider_id
      where ent.is_active and serving.is_active and provider.is_active
    `;
    return new Map(
      rows.map((row) => [
        row.catalog_model_id,
        {
          dailyCap: row.daily_cap,
          minTier: row.min_tier as 1 | 2 | 3,
          ...(row.covers ? { limits: row.covers } : {}),
        },
      ]),
    );
  }

  private async build(): Promise<CatalogSnapshot> {
    const rows = await this.sql<{ id: string; family: string; capabilities: unknown; updated_at: Date }[]>`
      select model.id, model.family, model.capabilities, model.updated_at
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

    const grants = await this.unlimitedByModel();

    // Insertion order carries the sort out of the query above, so the families
    // and their variants come back in the order the screens present them.
    const families = new Map<string, CatalogFamily>();
    let newest = 0;

    for (const row of rows) {
      const { family, variant } = CatalogCapabilitiesSchema.parse(row.capabilities);
      newest = Math.max(newest, row.updated_at.getTime());

      // Attached here rather than stored in `capabilities`, so the shop and the
      // quote path read one row and cannot come to disagree.
      const grant = grants.get(row.id);
      const offered = grant ? { ...variant, unlimited: grant } : variant;

      const existing = families.get(row.family);
      if (existing) existing.variants.push(offered);
      else families.set(row.family, { ...family, variants: [offered] });
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
