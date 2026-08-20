/**
 * Seed the editorial content into Postgres.
 *
 * Seven collections that used to be TypeScript constants — presets, the prompt
 * bank, skills, the featured shelf, courses, explore examples and the voice
 * list — now live in `content_items` (migration 0020) and reach the browser
 * through `GET /api/v1/content`.
 *
 * TWO RULES ABOUT WHAT THIS DOES NOT DO, both about not overruling a person:
 *
 *   • It never writes `status` on a row that already exists. Pulling something
 *     is a decision someone made about what the public sees — usually because
 *     it was wrong, broken or worse — and a seed run must not reverse it. New
 *     rows take the status the seed file gives them; existing rows keep theirs.
 *   • It never deletes. A row an admin added through the panel is not in this
 *     file and must survive a re-seed. Removing content is `delete from
 *     content_items where kind = ... and code = ...`, run deliberately.
 *
 * `sort_order` DOES update, and the asymmetry is the point: order is a
 * presentation preference this file is still the source of truth for, while
 * status is a judgement the file has no standing to make twice.
 *
 * Idempotent by construction, like every other publisher here: `content_items`
 * has an updated_at trigger and the served content version derives from it, so
 * an unconditional upsert would hand every client a new version each run.
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
    throw new Error(`content row ${row.kind}/${row.code} does not parse: ${(error as Error).message}`);
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
      // `status` is deliberately absent from the update list — see the header.
      const [changed] = await tx<{ id: string }[]>`
        insert into content_items (kind, code, status, sort_order, title, subtitle, body, category, family_code, seed, payload)
        values (
          ${row.kind}, ${row.code}, ${row.status}, ${row.sortOrder},
          ${row.title}, ${row.subtitle}, ${row.body}, ${row.category},
          ${row.familyCode}, ${row.seed}, ${tx.json(row.payload as never)}
        )
        on conflict (kind, code) do update set
          sort_order  = excluded.sort_order,
          title       = excluded.title,
          subtitle    = excluded.subtitle,
          body        = excluded.body,
          category    = excluded.category,
          family_code = excluded.family_code,
          seed        = excluded.seed,
          payload     = excluded.payload
        where
          content_items.sort_order  is distinct from excluded.sort_order
          or content_items.title       is distinct from excluded.title
          or content_items.subtitle    is distinct from excluded.subtitle
          or content_items.body        is distinct from excluded.body
          or content_items.category    is distinct from excluded.category
          or content_items.family_code is distinct from excluded.family_code
          or content_items.seed        is distinct from excluded.seed
          or content_items.payload     is distinct from excluded.payload
        returning id
      `;
      if (changed) written += 1;
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
