import { randomUUID } from "node:crypto";
import {
  ContentEntrySchema,
  ContentSnapshotSchema,
  type ContentEntry,
  type ContentSnapshot,
  type ContentWrite,
  type EditableContentKind,
} from "@vgen/contracts";
import { fromContentItem, toContentItem } from "@vgen/core";
import type { Sql, TransactionSql } from "postgres";
import { PublicDocument, fingerprintOf } from "./publicDocument";
import { atomically } from "./transaction";

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
      const flags = await this.flags();
      return fingerprintOf(`${row?.n ?? "0"}:${flags.siteBanner}:${flags.earlyAccess}`, row?.newest);
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
    const flags = await this.flags();

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
      flags,
    });
  }

  private async flags(): Promise<ContentSnapshot["flags"]> {
    const rows = await this.sql<{ code: string; is_enabled: boolean }[]>`
      select code, is_enabled from feature_flags where code in ('site_banner', 'early_access')
    `;
    const enabled = (code: string) => rows.find((row) => row.code === code)?.is_enabled;
    return {
      siteBanner: enabled("site_banner") ?? true,
      // Absent reads as on, exactly as signup reads it: a deleted row must not
      // turn the invite page into the open landing page while the API still
      // refuses every signup that page would send it.
      earlyAccess: enabled("early_access") ?? true,
    };
  }
}

interface ContentRow {
  id: string;
  kind: string;
  code: string;
  status: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  category: string | null;
  family_code: string | null;
  seed: string | null;
  payload: Record<string, unknown>;
}

/** What a new row's code starts with, so a code read in a log still says what it is. */
const CODE_PREFIX: Record<EditableContentKind, string> = { preset: "fx", course: "c", prompt_fragment: "f" };

/**
 * Effects, courses and the prompt bank, as the admin panel edits them.
 *
 * Every write builds the row with `fromContentItem` and reads it straight back
 * through `toContentItem`, the function the public document is built with, so
 * a row that would break `GET /content` is refused here instead of being
 * found by a visitor.
 *
 * Deleting archives. The seeder is insert-only and matches on (kind, code), so
 * a seeded row that was hard-deleted would be inserted again by the next
 * deploy; an archived one stays archived. Archived rows are not listed, so to
 * the panel they are gone.
 */
export class PostgresAdminContentRepository {
  constructor(private readonly sql: Sql) {}

  async list(kind: EditableContentKind): Promise<ContentEntry[]> {
    const rows = await this.sql<ContentRow[]>`
      select id, kind, code, status, title, subtitle, body, category, family_code, seed, payload
      from content_items
      where kind = ${kind} and status <> 'archived'
      order by sort_order asc, created_at asc
    `;
    return rows.map(entryOf);
  }

  /** New rows go first: the one just added is the one the admin is looking for. */
  async create(write: ContentWrite, userId: string): Promise<ContentEntry | "unknown_family"> {
    return atomically(this.sql)(async (tx) => {
      if (!(await familyExists(tx, write))) return "unknown_family";
      const code = `${CODE_PREFIX[write.kind]}-${randomUUID().slice(0, 8)}`;
      const row = checked(fromContentItem(write, code, code));
      const [saved] = await tx<ContentRow[]>`
        insert into content_items (kind, code, status, sort_order, title, subtitle, body, category, family_code, seed, payload, updated_by)
        values (
          ${row.kind}, ${row.code}, ${write.status},
          (select coalesce(min(sort_order), 0) - 1 from content_items where kind = ${row.kind}),
          ${row.title}, ${row.subtitle}, ${row.body}, ${row.category}, ${row.familyCode}, ${row.seed},
          ${tx.json(row.payload as never)}, ${userId}
        )
        returning id, kind, code, status, title, subtitle, body, category, family_code, seed, payload
      `;
      return entryOf(saved!);
    });
  }

  /** Keeps the row's code, seed and place in the order; replaces everything else. */
  async update(id: string, write: ContentWrite, userId: string): Promise<ContentEntry | "not_found" | "unknown_family"> {
    return atomically(this.sql)(async (tx) => {
      const [current] = await tx<{ kind: string; code: string; seed: string | null }[]>`
        select kind, code, seed from content_items where id = ${id} and status <> 'archived' for update
      `;
      if (!current || current.kind !== write.kind) return "not_found";
      if (!(await familyExists(tx, write))) return "unknown_family";
      const row = checked(fromContentItem(write, current.code, current.seed ?? current.code));
      const [saved] = await tx<ContentRow[]>`
        update content_items set
          status = ${write.status},
          title = ${row.title},
          subtitle = ${row.subtitle},
          body = ${row.body},
          category = ${row.category},
          family_code = ${row.familyCode},
          payload = ${tx.json(row.payload as never)},
          updated_by = ${userId}
        where id = ${id}
        returning id, kind, code, status, title, subtitle, body, category, family_code, seed, payload
      `;
      return entryOf(saved!);
    });
  }

  async archive(id: string, userId: string): Promise<{ kind: string; code: string } | null> {
    const [archived] = await this.sql<{ kind: string; code: string }[]>`
      update content_items set status = 'archived', updated_by = ${userId}
      where id = ${id} and status <> 'archived' and kind in ('preset', 'course', 'prompt_fragment')
      returning kind, code
    `;
    return archived ?? null;
  }
}

function entryOf(row: ContentRow): ContentEntry {
  const parsed = toContentItem({ ...row, familyCode: row.family_code });
  return ContentEntrySchema.parse({ id: row.id, kind: parsed.kind, status: row.status, item: parsed.item });
}

/** Throws when the row would not read back, which would be a bug in `fromContentItem` rather than bad input. */
function checked<T extends Parameters<typeof toContentItem>[0]>(row: T): T {
  toContentItem(row);
  return row;
}

/**
 * The seeder's rule, kept for the panel: a card pointing at a family no active
 * model carries opens nothing, and the person who notices is a customer.
 */
async function familyExists(tx: TransactionSql, write: ContentWrite): Promise<boolean> {
  const family = write.kind === "prompt_fragment" ? undefined : write.item.familyId;
  if (family === undefined) return true;
  const [row] = await tx<{ ok: boolean }[]>`
    select exists (
      select 1
      from provider_models model
      join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active and model.capabilities ? 'variant' and model.family = ${family}
    ) as ok
  `;
  return row?.ok === true;
}
