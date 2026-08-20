import { ContentSnapshotSchema, type ContentSnapshot } from "@vgen/contracts";
import { toContentItem } from "@vgen/core";
import type { Sql } from "postgres";

/**
 * The editorial content, read out of `content_items`.
 *
 * The row-to-item mapping is `toContentItem` in @vgen/core, not here, because
 * `scripts/publish-content.ts` runs every seed row through the same function
 * before it writes one. See that file for why it is one function and not two.
 *
 * The read filters to published and sorts by the admin's order, which is why
 * the customer contract carries neither field — see packages/contracts/src/content.ts.
 */

export interface CustomerContentRepository {
  list(): Promise<ContentSnapshot>;
}

export class PostgresContentRepository implements CustomerContentRepository {
  constructor(private readonly sql: Sql) {}

  async list(): Promise<ContentSnapshot> {
    const rows = await this.sql<
      {
        kind: string;
        code: string;
        title: string | null;
        subtitle: string | null;
        body: string | null;
        category: string | null;
        family_code: string | null;
        seed: string | null;
        payload: Record<string, unknown>;
        updated_at: Date;
      }[]
    >`
      select kind, code, title, subtitle, body, category, family_code, seed, payload, updated_at
      from content_items
      where status = 'published'
      order by kind asc, sort_order asc
    `;

    const snapshot: Omit<ContentSnapshot, "version" | "publishedAt"> = {
      presets: [],
      fragments: [],
      skills: [],
      featured: [],
      courses: [],
      examples: [],
      voices: [],
    };
    let newest = 0;

    for (const row of rows) {
      newest = Math.max(newest, row.updated_at.getTime());
      const parsed = toContentItem({ ...row, familyCode: row.family_code });

      // Exhaustive by construction: ParsedContentItem's union and the seven
      // arrays are the same seven names, so a new kind fails to compile here
      // rather than being silently dropped from the payload.
      if (parsed.kind === "preset") snapshot.presets.push(parsed.item);
      else if (parsed.kind === "prompt_fragment") snapshot.fragments.push(parsed.item);
      else if (parsed.kind === "skill") snapshot.skills.push(parsed.item);
      else if (parsed.kind === "featured") snapshot.featured.push(parsed.item);
      else if (parsed.kind === "course") snapshot.courses.push(parsed.item);
      else if (parsed.kind === "example") snapshot.examples.push(parsed.item);
      else snapshot.voices.push(parsed.item);
    }

    // Derived from the rows, exactly as the catalog version is: `content_items`
    // has an updated_at trigger, so the newest row IS the moment the content
    // last changed. A second version table could disagree with the rows.
    return ContentSnapshotSchema.parse({ version: `content-${newest}`, publishedAt: newest, ...snapshot });
  }
}
