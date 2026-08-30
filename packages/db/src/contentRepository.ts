import { ContentSnapshotSchema, type ContentSnapshot } from "@vgen/contracts";
import { toContentItem } from "@vgen/core";
import type { Sql } from "postgres";
import { PublicDocument, fingerprintOf } from "./publicDocument";

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

  /**
   * Rebuilt only when something publishes. See `PublicDocument`.
   *
   * The count matters here more than anywhere: unpublishing an item is the
   * ordinary editorial action, and it changes what this document says without
   * touching the newest `updated_at` in the remaining set.
   */
  private readonly document = new PublicDocument(
    async () => {
      const [row] = await this.sql<{ n: string; newest: Date | null }[]>`
        select count(*)::text as n, max(updated_at) as newest
        from content_items where status = 'published'
      `;
      // The banner switch rides on this document, so it belongs in the
      // fingerprint too. Without it an admin turning the strip off would be
      // ignored until somebody happened to publish a content item, which is
      // the kind of delay that gets diagnosed as "the toggle does nothing".
      //
      // The *value*, not its `updated_at`. A timestamp was the obvious reach
      // and it is wrong twice: `now()` is fixed for the length of a
      // transaction, so two writes inside one share a stamp, and a value is
      // what this document actually depends on. Fingerprinting the thing
      // itself needs no argument about when it changed.
      const [flag] = await this.sql<{ is_enabled: boolean }[]>`
        select is_enabled from feature_flags where code = 'site_banner'
      `;
      return fingerprintOf(`${row?.n ?? "0"}:${flag?.is_enabled ?? true}`, row?.newest);
    },
    () => this.build(),
  );

  async list(): Promise<ContentSnapshot> {
    return this.document.get();
  }

  private async build(): Promise<ContentSnapshot> {
    // Read alongside the rows rather than through `PostgresAccessRepository`,
    // which owns the write. One statement, no import, and this file is already
    // the only reader of the served shape.
    const [flag] = await this.sql<{ is_enabled: boolean }[]>`
      select is_enabled from feature_flags where code = 'site_banner'
    `;

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

    const snapshot: Omit<ContentSnapshot, "version" | "publishedAt" | "flags"> = {
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
    return ContentSnapshotSchema.parse({
      version: `content-${newest}`,
      publishedAt: newest,
      // Absent means nobody has turned it off. See the contract for why that
      // reads as on rather than off.
      ...snapshot,
      flags: { siteBanner: flag?.is_enabled ?? true },
    });
  }
}
