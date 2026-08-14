import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCatalogRepository } from "./catalogRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const family = (id: string, name: string) => ({
  id,
  name,
  vendor: "DEEV Test",
  kind: "image" as const,
  blurb: `${name} description`,
  grad: "linear-gradient(135deg,#111,#333)",
  controls: [],
  variants: [{ id: `${id}-v1`, model: `${id}/v1`, label: "v1" }],
});

describe("Postgres catalog repository", () => {
  it("returns the bootstrap snapshot when nothing is published", async () => {
    await inRollback(sql, async (tx) => {
      // A draft version must not be served. Publishing is the gate, not existence.
      await tx`insert into catalog_versions (note) values ('draft only')`;
      await tx`update catalog_versions set published_at = null where published_at is not null`;

      await expect(new PostgresCatalogRepository(tx).list()).resolves.toEqual({
        version: "bootstrap-v1",
        publishedAt: 0,
        families: [],
      });
    });
  });

  it("returns active families from the latest published version", async () => {
    await inRollback(sql, async (tx) => {
      const [older] = await tx<{ id: number }[]>`
        insert into catalog_versions (published_at, note) values (now() - interval '1 day', 'old') returning id
      `;
      const [latest] = await tx<{ id: number; published_at: Date }[]>`
        insert into catalog_versions (published_at, note) values (now(), 'latest') returning id, published_at
      `;
      await tx`
        insert into models (catalog_version, key, family, kind, min_tier, spec, active)
        values
          (${older!.id}, 'old', 'old', 'image', 1, ${tx.json(family("old", "Old"))}, true),
          (${latest!.id}, 'beta', 'beta', 'image', 1, ${tx.json(family("beta", "Beta"))}, true),
          (${latest!.id}, 'alpha', 'alpha', 'image', 1, ${tx.json(family("alpha", "Alpha"))}, true),
          (${latest!.id}, 'hidden', 'hidden', 'image', 1, ${tx.json(family("hidden", "Hidden"))}, false)
      `;

      const snapshot = await new PostgresCatalogRepository(tx).list();

      // Latest published version only, inactive rows excluded, ordered by key.
      expect(snapshot.version).toBe(`catalog-${latest!.id}`);
      expect(snapshot.publishedAt).toBe(latest!.published_at.getTime());
      expect(snapshot.families.map((item) => item.id)).toEqual(["alpha", "beta"]);
    });
  });
});
