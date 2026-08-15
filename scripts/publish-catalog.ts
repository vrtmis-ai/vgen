import { config } from "dotenv";
import postgres from "postgres";
import { CatalogSnapshotSchema } from "../src/app/contracts/catalog";
import { FAMILIES } from "../src/data/models";
import { minTierFor } from "../src/data/plans";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish the catalog");

CatalogSnapshotSchema.parse({ version: "candidate", publishedAt: Date.now(), families: FAMILIES });
const sql = postgres(databaseUrl, { max: 1 });

try {
  const published = await sql.begin(async (transaction) => {
    const [version] = await transaction<{ id: number }[]>`
      insert into catalog_versions (note) values ('Published from source catalog') returning id
    `;
    if (!version) throw new Error("Catalog version insert returned no row");

    for (const family of FAMILIES) {
      const familySpec = JSON.parse(JSON.stringify(family)) as Parameters<typeof transaction.json>[0];
      await transaction`
        insert into models (catalog_version, key, family, kind, min_tier, max_prompt, no_prompt, spec, active)
        values (
          ${version.id},
          ${family.id},
          ${family.id},
          ${family.kind},
          ${minTierFor(family.id)},
          ${family.maxPrompt ?? null},
          ${family.noPrompt ?? false},
          ${transaction.json(familySpec)},
          true
        )
      `;
    }

    const [row] = await transaction<{ id: number; published_at: Date }[]>`
      update catalog_versions set published_at = now() where id = ${version.id} returning id, published_at
    `;
    if (!row) throw new Error("Catalog publish update returned no row");
    return row;
  });

  console.log(`Published catalog-${published.id} with ${FAMILIES.length} families at ${published.published_at.toISOString()}`);
} finally {
  await sql.end();
}
