import { CatalogFamilySchema, CatalogSnapshotSchema, type CatalogSnapshot } from "@vgen/contracts";
import type { Sql } from "postgres";

export interface CustomerCatalogRepository {
  list(): Promise<CatalogSnapshot>;
}

export class PostgresCatalogRepository implements CustomerCatalogRepository {
  constructor(private readonly sql: Sql) {}

  async list(): Promise<CatalogSnapshot> {
    const [version] = await this.sql<{ id: number; published_at: Date }[]>`
      select id, published_at
      from catalog_versions
      where published_at is not null
      order by published_at desc, id desc
      limit 1
    `;
    if (!version) return CatalogSnapshotSchema.parse({ version: "bootstrap-v1", publishedAt: 0, families: [] });

    const rows = await this.sql<{ spec: unknown }[]>`
      select spec
      from models
      where catalog_version = ${version.id} and active = true
      order by key asc
    `;
    return CatalogSnapshotSchema.parse({
      version: `catalog-${version.id}`,
      publishedAt: version.published_at.getTime(),
      families: rows.map((row) => CatalogFamilySchema.parse(row.spec)),
    });
  }
}
