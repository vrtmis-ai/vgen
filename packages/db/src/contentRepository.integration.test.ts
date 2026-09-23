import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAccessRepository } from "./accessRepository";
import { PostgresAdminContentRepository, PostgresContentRepository } from "./contentRepository";
import { connect, expectDbError, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * What the customer is served out of `content_items`.
 *
 * The interesting cases here are all about what does NOT come back. Screens
 * used to call a `published()` helper themselves, and a screen that forgot it
 * showed a draft to a customer. Moving the filter into SQL means the only way
 * to serve a draft is to change this query, so these tests pin the query.
 */

interface RowFields {
  kind: string;
  code: string;
  status?: string;
  sortOrder?: number;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  category?: string | null;
  familyCode?: string | null;
  seed?: string | null;
  payload?: Record<string, unknown>;
  /** Only the version test sets this. See the note there for why not by UPDATE. */
  updatedAt?: string;
}

async function insert(tx: Sql, fields: RowFields): Promise<void> {
  await tx`
    insert into content_items (kind, code, status, sort_order, title, subtitle, body, category, family_code, seed, payload, updated_at)
    values (
      ${fields.kind}, ${fields.code}, ${fields.status ?? "published"}, ${fields.sortOrder ?? 0},
      ${fields.title ?? null}, ${fields.subtitle ?? null}, ${fields.body ?? null}, ${fields.category ?? null},
      ${fields.familyCode ?? null}, ${fields.seed ?? null}, ${tx.json((fields.payload ?? {}) as never)},
      ${fields.updatedAt ?? tx`now()`}
    )
  `;
}

const preset = (code: string, extra: Partial<RowFields> = {}): RowFields => ({
  kind: "preset",
  code,
  title: `preset ${code}`,
  body: "a prompt, of ",
  category: "camera",
  familyCode: "seedance",
  seed: `seed-${code}`,
  payload: { kind: "video", openEnded: true },
  ...extra,
});

/** The seeded rows are in the way of counting, so every test works on its own codes. */
async function listOnly(tx: Sql, codes: string[]) {
  await tx`delete from content_items where code <> all(${codes})`;
  return new PostgresContentRepository(tx).list();
}

describe("PostgresContentRepository", () => {
  it("serves published rows and withholds drafts and archived ones", async () => {
    await inRollback(sql, async (tx) => {
      await insert(tx, preset("live"));
      await insert(tx, preset("staged", { status: "draft" }));
      await insert(tx, preset("pulled", { status: "archived" }));

      const snapshot = await listOnly(tx, ["live", "staged", "pulled"]);

      expect(snapshot.presets.map((row) => row.id)).toEqual(["live"]);
    });
  });

  it("returns each kind already in the admin's order, so a screen never sorts", async () => {
    await inRollback(sql, async (tx) => {
      await insert(tx, preset("third", { sortOrder: 30 }));
      await insert(tx, preset("first", { sortOrder: 10 }));
      await insert(tx, preset("second", { sortOrder: 20 }));

      const snapshot = await listOnly(tx, ["first", "second", "third"]);

      expect(snapshot.presets.map((row) => row.id)).toEqual(["first", "second", "third"]);
    });
  });

  it("splits the kinds into their own collections rather than one tagged list", async () => {
    await inRollback(sql, async (tx) => {
      await insert(tx, preset("p"));
      await insert(tx, { kind: "voice", code: "v", title: "James", subtitle: "warm" });
      await insert(tx, {
        kind: "course",
        code: "c",
        title: "course",
        subtitle: "blurb",
        category: "beginner",
        seed: "s",
        payload: { lessons: [{ id: "l1", title: "one", seconds: 60 }] },
      });

      const snapshot = await listOnly(tx, ["p", "v", "c"]);

      expect(snapshot.presets).toHaveLength(1);
      expect(snapshot.voices).toHaveLength(1);
      expect(snapshot.courses).toHaveLength(1);
      expect(snapshot.courses[0]?.level).toBe("beginner");
      expect(snapshot.fragments).toEqual([]);
    });
  });

  it("derives the version from the newest row, so a client can tell it is stale", async () => {
    await inRollback(sql, async (tx) => {
      // Set at INSERT, not by a later UPDATE. `set_updated_at` is a BEFORE
      // UPDATE trigger that assigns `now()` unconditionally, so an update
      // cannot choose a timestamp — and `now()` is frozen for the whole
      // transaction anyway, which would give every row here the same one.
      await insert(tx, preset("older", { updatedAt: "2026-01-01T00:00:00Z" }));
      await insert(tx, preset("newer", { updatedAt: "2026-06-01T00:00:00Z" }));

      const snapshot = await listOnly(tx, ["older", "newer"]);

      // The newest row IS the version. Nothing writes one anywhere, because a
      // second version table could disagree with the rows it claims to describe.
      expect(snapshot.publishedAt).toBe(Date.UTC(2026, 5, 1));
      expect(snapshot.version).toBe(`content-${Date.UTC(2026, 5, 1)}`);
    });
  });

  it("fails loudly on a row that cannot be rendered rather than serving half a card", async () => {
    await inRollback(sql, async (tx) => {
      // Passes every column constraint — a course row with a lessons key that
      // is empty. Only the schema catches it, and the alternative to throwing
      // is a course page with a heading and nothing under it.
      await insert(tx, {
        kind: "course",
        code: "hollow",
        title: "t",
        subtitle: "b",
        category: "beginner",
        seed: "s",
        payload: { lessons: [] },
      });

      await expect(listOnly(tx, ["hollow"])).rejects.toThrow();
    });
  });

  describe("the constraints that stop a broken row being stored at all", () => {
    it("refuses a second row with the same kind and code", async () => {
      await inRollback(sql, async (tx) => {
        await insert(tx, preset("twice"));
        const error = await expectDbError(tx, () => insert(tx, preset("twice")));
        expect(error.message).toContain("content_items_kind_code_key");
      });
    });

    it("allows the same code under two different kinds", async () => {
      // Codes are only unique within a collection: an admin naming a course
      // `intro` must not be blocked by a preset called `intro`.
      await inRollback(sql, async (tx) => {
        await insert(tx, preset("intro"));
        await insert(tx, { kind: "voice", code: "intro", title: "Intro", subtitle: "note" });
        const rows = await tx<{ count: string }[]>`select count(*) as count from content_items where code = 'intro'`;
        expect(Number(rows[0]?.count)).toBe(2);
      });
    });

    it("refuses a preset with no prompt behind it", async () => {
      await inRollback(sql, async (tx) => {
        const error = await expectDbError(tx, () => insert(tx, preset("mute", { body: null })));
        expect(error.message).toContain("content_items_bodied");
      });
    });

    it("refuses a titled kind with no title, and allows an example without one", async () => {
      await inRollback(sql, async (tx) => {
        const error = await expectDbError(tx, () => insert(tx, preset("nameless", { title: null })));
        expect(error.message).toContain("content_items_titled");

        // An example is a picture and a prompt. There is nothing to head it,
        // and inventing one would put a machine-written label on a card.
        // Not `e1` — the seeded examples are in this table and a test that
        // borrows a real code fails for a reason it is not testing.
        await insert(tx, {
          kind: "example",
          code: "untitled-under-test",
          body: "a prompt",
          familyCode: "flux",
          seed: "s",
          payload: { w: 16, h: 9 },
        });
      });
    });

    it("refuses a kind nothing knows how to render", async () => {
      await inRollback(sql, async (tx) => {
        const error = await expectDbError(tx, () => insert(tx, { kind: "tutorial", code: "t1", title: "t" }));
        expect(error.message).toContain("content_items_kind_check");
      });
    });
  });
});

describe("the site banner switch", () => {
  /**
   * Absent means on, which is the opposite of how `early_access` reads a
   * missing row.
   *
   * That asymmetry is deliberate and worth pinning: the invite gate decides who
   * may sign up, so a deleted row has to fail closed. This one decides whether
   * a strip is painted, and failing closed would silently stop advertising a
   * live campaign — which nobody would notice until the campaign ended.
   */
  it("is on when nobody has turned it off", async () => {
    await inRollback(sql, async (tx) => {
      await tx`delete from feature_flags where code = 'site_banner'`;

      expect(await new PostgresAccessRepository(tx).isSiteBanner()).toBe(true);
      const served = await new PostgresContentRepository(tx).list();
      expect(served.flags.siteBanner).toBe(true);
    });
  });

  it("reaches the served document when it is turned off", async () => {
    await inRollback(sql, async (tx) => {
      await new PostgresAccessRepository(tx).setSiteBanner(false, null);

      const served = await new PostgresContentRepository(tx).list();
      expect(served.flags.siteBanner).toBe(false);
    });
  });

  /**
   * The toggle has to survive the memoisation, and this is the test that says
   * so.
   *
   * `PostgresContentRepository` caches its document behind a fingerprint built
   * from the content rows. Toggling a flag touches no content row, so without
   * the flag's own `updated_at` in that fingerprint the cached answer would be
   * served until somebody happened to publish an item — the failure mode that
   * gets reported as "the switch does nothing" and diagnosed as a UI bug.
   *
   * One repository instance across both reads on purpose: a fresh one would
   * have an empty cache and pass regardless.
   */
  it("is not hidden behind the cached content document", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const content = new PostgresContentRepository(tx);
      await access.setSiteBanner(true, null);
      expect((await content.list()).flags.siteBanner).toBe(true);

      await access.setSiteBanner(false, null);

      expect((await content.list()).flags.siteBanner).toBe(false);
    });
  });

  it("records who turned it off", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await new PostgresAccessRepository(tx).setSiteBanner(false, userId);

      const [row] = await tx<{ updated_by: string | null; is_enabled: boolean }[]>`
        select updated_by, is_enabled from feature_flags where code = 'site_banner'
      `;
      expect(row).toMatchObject({ updated_by: userId, is_enabled: false });
    });
  });
});

describe("the early access flag on the served document", () => {
  it("fails closed when the row is missing, as the signup gate does", async () => {
    await inRollback(sql, async (tx) => {
      await tx`delete from feature_flags where code = 'early_access'`;

      expect((await new PostgresContentRepository(tx).list()).flags.earlyAccess).toBe(true);
    });
  });

  it("follows the admin switch through the cached document", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const content = new PostgresContentRepository(tx);
      await access.setEarlyAccess(true, null);
      expect((await content.list()).flags.earlyAccess).toBe(true);

      await access.setEarlyAccess(false, null);

      expect((await content.list()).flags.earlyAccess).toBe(false);
    });
  });
});

/**
 * The admin panel's writes. What matters is what the public document does
 * afterwards, because that is what a visitor sees: a new effect appears first,
 * a draft disappears, an archived row stays gone.
 */
describe("editing effects, courses and the prompt bank", () => {
  async function aFamily(tx: Sql): Promise<string> {
    const [row] = await tx<{ family: string }[]>`
      select model.family from provider_models model join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active and model.capabilities ? 'variant' and model.family is not null
      order by model.family limit 1
    `;
    return row!.family;
  }

  const cover = "/api/v1/content/media/0192f7a0-0000-7000-8000-000000000001.jpg";
  const effect = (familyId: string, title = "نور نئون") =>
    ({
      kind: "preset",
      status: "published",
      item: {
        title,
        prompt: "neon rim light, rain-soaked street, ",
        familyId,
        openEnded: true,
        kind: "video",
        category: "vfx",
        coverUrl: cover,
      },
    }) as const;

  it("serves a new effect first, with its cover", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const created = await new PostgresAdminContentRepository(tx).create(effect(await aFamily(tx)), userId);
      if (created === "unknown_family") throw new Error("expected a created row");

      const [first] = (await new PostgresContentRepository(tx).list()).presets;
      expect(first).toMatchObject({ id: created.item.id, title: "نور نئون", coverUrl: cover });
      expect(created.item.id).toMatch(/^fx-/);
    });
  });

  it("refuses an effect on a family no active model carries", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      expect(await new PostgresAdminContentRepository(tx).create(effect("no-such-family"), userId)).toBe("unknown_family");
    });
  });

  it("keeps the code on an edit, and a draft leaves the public document", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const family = await aFamily(tx);
      const created = await admin.create(effect(family), userId);
      if (created === "unknown_family") throw new Error("expected a created row");

      const edited = await admin.update(created.id, { ...effect(family, "نور سرد"), status: "draft" }, userId);

      expect(edited).toMatchObject({ status: "draft", item: { id: created.item.id, title: "نور سرد" } });
      const served = (await new PostgresContentRepository(tx).list()).presets.map((preset) => preset.id);
      expect(served).not.toContain(created.item.id);
    });
  });

  it("archives on delete, so the row is gone from the panel and the site and stays gone", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const family = await aFamily(tx);
      const created = await admin.create(effect(family), userId);
      if (created === "unknown_family") throw new Error("expected a created row");

      expect(await admin.archive(created.id, userId)).toEqual({ kind: "preset", code: created.item.id });

      expect((await admin.list("preset")).map((entry) => entry.id)).not.toContain(created.id);
      expect((await new PostgresContentRepository(tx).list()).presets.map((preset) => preset.id)).not.toContain(created.item.id);
      expect(await admin.archive(created.id, userId)).toBeNull();
      expect(await admin.update(created.id, effect(family), userId)).toBe("not_found");
    });
  });

  it("round-trips a course's lessons and cover video", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const created = await new PostgresAdminContentRepository(tx).create(
        {
          kind: "course",
          status: "published",
          item: {
            title: "نورپردازی سینمایی",
            blurb: "سه درس کوتاه.",
            level: "beginner",
            cover: { url: "/api/v1/content/media/0192f7a0-0000-7000-8000-000000000002.mp4", kind: "video" },
            lessons: [
              { id: "l-1", title: "نور کلیدی", seconds: 95, videoUrl: "/api/v1/content/media/0192f7a0-0000-7000-8000-000000000003.mp4" },
            ],
          },
        },
        userId,
      );
      if (created === "unknown_family") throw new Error("expected a created row");

      const served = (await new PostgresContentRepository(tx).list()).courses.find((course) => course.id === created.item.id);
      expect(served).toMatchObject({ cover: { kind: "video" }, lessons: [{ title: "نور کلیدی", seconds: 95 }] });
    });
  });

  it("will not turn an effect into a prompt-bank entry", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const created = await admin.create(effect(await aFamily(tx)), userId);
      if (created === "unknown_family") throw new Error("expected a created row");

      const crossed = await admin.update(
        created.id,
        { kind: "prompt_fragment", status: "published", item: { label: "x", fragment: "x", category: "camera", note: "x" } },
        userId,
      );

      expect(crossed).toBe("not_found");
    });
  });
});

/**
 * The shelves, which were an enum until 0034.
 *
 * What matters is the slug: it is what every item under a shelf points at, so
 * renaming must not touch it and deleting must not orphan it.
 */
describe("the shelves effects and the prompt bank are filed under", () => {
  /** Its own copy: the describe above keeps one for its own rows. */
  async function aFamily(tx: Sql): Promise<string> {
    const [row] = await tx<{ family: string }[]>`
      select model.family from provider_models model join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active and model.capabilities ? 'variant' and model.family is not null
      order by model.family limit 1
    `;
    return row!.family;
  }

  const shelf = (scope: "preset" | "prompt_fragment", label: string) =>
    ({ kind: "category", status: "published", item: { scope, label } }) as const;

  it("appends a new shelf after the ones people already know, and serves it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);

      const created = await admin.create(shelf("preset", "تایپوگرافی"), userId);
      if (created === "unknown_family") throw new Error("expected a created shelf");

      const served = (await new PostgresContentRepository(tx).list()).categories;
      const presetShelves = served.filter((category) => category.scope === "preset");
      expect(presetShelves.at(-1)).toMatchObject({ label: "تایپوگرافی", scope: "preset" });
      expect(created.kind === "category" && created.item.slug).toMatch(/^c-/);
    });
  });

  it("keeps the slug when the label changes, so nothing under it moves", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const created = await admin.create(shelf("prompt_fragment", "نور"), userId);
      if (created === "unknown_family" || created.kind !== "category") throw new Error("expected a created shelf");

      const renamed = await admin.update(created.id, shelf("prompt_fragment", "نورپردازی"), userId);

      expect(renamed).toMatchObject({ item: { slug: created.item.slug, label: "نورپردازی" } });
    });
  });

  it("refuses to delete a shelf with items on it, and allows it once they leave", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const family = await aFamily(tx);
      const created = await admin.create(shelf("preset", "شب"), userId);
      if (created === "unknown_family" || created.kind !== "category") throw new Error("expected a created shelf");
      const effect = await admin.create(
        {
          kind: "preset",
          status: "published",
          item: { title: "نئون", prompt: "neon, ", familyId: family, openEnded: true, kind: "video", category: created.item.slug },
        },
        userId,
      );
      if (effect === "unknown_family") throw new Error("expected a created effect");

      expect(await admin.archive(created.id, userId)).toEqual({ inUse: 1 });

      await admin.archive(effect.id, userId);
      expect(await admin.archive(created.id, userId)).toMatchObject({ kind: "category" });
    });
  });

  it("will not let one list hold two shelves with the same slug", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const created = await admin.create(shelf("preset", "شب"), userId);
      if (created === "unknown_family" || created.kind !== "category") throw new Error("expected a created shelf");

      // The index, not the application: two admins adding a shelf at the same
      // moment race past any check this code could make.
      const error = await expectDbError(
        tx,
        () => tx`
          insert into content_items (kind, code, status, sort_order, title, body, category)
          values ('category', 'cat-dupe', 'published', 99, 'شب دیگر', ${created.item.slug}, 'preset')
        `,
      );

      expect(error.message).toMatch(/content_items_category_slug_idx/);
    });
  });
});

/* New rows land first and nothing could change that afterwards. A swap with
   the neighbour, not a renumbered list: two admins nudging different rows then
   touch different pairs. */
describe("the order the site draws", () => {
  it("swaps with the neighbour, and does nothing at the end", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const first = await admin.create({ kind: "category", status: "published", item: { scope: "preset", label: "الف" } }, userId);
      const second = await admin.create({ kind: "category", status: "published", item: { scope: "preset", label: "ب" } }, userId);
      if (first === "unknown_family" || second === "unknown_family") throw new Error("expected two shelves");

      // Both were appended, so `second` is last. Moving it up puts it before `first`.
      expect(await admin.move(second.id, "up", userId)).toBe("moved");

      const shelves = await admin.list("category");
      const order = shelves.map((entry) => entry.item.id);
      expect(order.indexOf(second.item.id)).toBeLessThan(order.indexOf(first.item.id));

      // The top of the list has no neighbour above it — the seeded shelves are
      // in this list too, so that is the first of those, not one of the pair.
      expect(await admin.move(shelves[0]!.id, "up", userId)).toBe("at_the_end");
    });
  });

  it("publishes and unpublishes several at once, counting only what changed", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = new PostgresAdminContentRepository(tx);
      const draft = await admin.create({ kind: "category", status: "draft", item: { scope: "preset", label: "پیش‌نویس" } }, userId);
      const live = await admin.create({ kind: "category", status: "published", item: { scope: "preset", label: "زنده" } }, userId);
      if (draft === "unknown_family" || live === "unknown_family") throw new Error("expected two shelves");

      // Only the draft moves; the published one is already where it is asked to be.
      expect(await admin.setStatus([draft.id, live.id], "published", userId)).toBe(1);
      expect(await admin.setStatus([draft.id, live.id], "draft", userId)).toBe(2);
    });
  });
});
