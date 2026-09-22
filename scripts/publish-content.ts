/**
 * Seed the editorial content into Postgres.
 *
 * Seven collections that used to be TypeScript constants — presets, the prompt
 * bank, skills, the featured shelf, courses, explore examples and the voice
 * list — now live in `content_items` (migration 0020) and reach the browser
 * through `GET /api/v1/content`.
 *
 * INSERT-ONLY. A row that already exists is never touched, because the admin
 * panel edits effects, courses and the prompt bank in place, and this runs on
 * every deploy: an upsert here would put back the seed file's title and prompt
 * over whatever an admin wrote, and the deploy after an edit would undo it.
 * (It used to update everything but `status`, which was right while this file
 * was the only author.) So:
 *
 *   • A changed row in content.rows.json reaches a fresh database only. To
 *     change one that exists, edit it in the panel.
 *   • It never deletes. A row an admin added is not in this file and must
 *     survive a re-seed. The panel's delete archives rather than deletes, so a
 *     seeded row an admin removed is not inserted again here.
 *
 * Idempotent by construction: a second run inserts nothing, so the served
 * content version does not move.
 *
 * Run: pnpm content:publish   (needs DATABASE_URL)
 */
import { config } from "dotenv";
import postgres from "postgres";
import { toContentItem, type ContentSeedRow } from "@vgen/core";
import seed from "../src/data/content.rows.json" with { type: "json" };

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish content");

interface SeedRow extends ContentSeedRow {
  status: string;
  sortOrder: number;
}

const rows = seed.rows as unknown as SeedRow[];

// Parse before connecting. A row that would not survive being read back is not
// worth writing, and finding that out after a partial write is worse. This runs
// through the same `toContentItem` the API serves with, so "it seeded" and "a
// screen can render it" are the same statement rather than two hopes.
for (const row of rows) {
  try {
    toContentItem(row);
  } catch (error) {
    throw new Error(`content row ${row.kind}/${row.code} does not parse: ${(error as Error).message}`, { cause: error });
  }
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    // Which families exist, asked once. A content row pointing at a family the
    // catalogue does not carry is a card that opens nothing — the same failure
    // publish-pricing refuses rather than invents, and for the same reason:
    // the person who notices is otherwise a customer.
    const families = await tx<{ family: string }[]>`
      select distinct model.family
      from provider_models model
      join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active and model.capabilities ? 'variant' and model.family is not null
    `;
    const known = new Set(families.map((row) => row.family));
    if (known.size === 0) throw new Error("the catalogue is empty — run pnpm catalog:publish first");

    for (const row of rows) {
      if (row.familyCode !== null && !known.has(row.familyCode)) {
        throw new Error(`content row ${row.kind}/${row.code} names family "${row.familyCode}", which no active model carries`);
      }
      // A skill's steps each name a family too, and a step pointing nowhere
      // breaks the run rather than the card.
      const steps = row.payload["steps"];
      if (Array.isArray(steps)) {
        for (const step of steps as { familyId?: string }[]) {
          if (step.familyId !== undefined && !known.has(step.familyId)) {
            throw new Error(`skill ${row.code} has a step on family "${step.familyId}", which no active model carries`);
          }
        }
      }
    }

    let written = 0;
    for (const row of rows) {
      // Insert-only — see the header.
      const [inserted] = await tx<{ id: string }[]>`
        insert into content_items (kind, code, status, sort_order, title, subtitle, body, category, family_code, seed, payload)
        values (
          ${row.kind}, ${row.code}, ${row.status}, ${row.sortOrder},
          ${row.title}, ${row.subtitle}, ${row.body}, ${row.category},
          ${row.familyCode}, ${row.seed}, ${tx.json(row.payload as never)}
        )
        on conflict (kind, code) do nothing
        returning id
      `;
      if (inserted) written += 1;
    }

    const counts = await tx<{ kind: string; count: string }[]>`
      select kind, count(*) as count from content_items group by kind order by kind
    `;
    return { written, counts };
  });

  if (summary.written === 0) {
    console.log("content already current, nothing written");
  } else {
    console.log(`wrote ${summary.written} of ${rows.length} content rows`);
  }
  console.log(summary.counts.map((row) => `  ${row.kind}: ${row.count}`).join("\n"));
} finally {
  await sql.end();
}
