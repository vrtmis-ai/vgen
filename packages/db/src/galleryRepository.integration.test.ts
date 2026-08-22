import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAssetsRepository } from "./assetsRepository";
import { PostgresGalleryRepository } from "./galleryRepository";
import { connect, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * Reading a customer's own work back.
 *
 * Two claims are worth more than the rest here and both are about ownership
 * rather than about shape: a gallery must never contain somebody else's
 * generation, and asking for a job by id must not confirm one exists when it is
 * not yours. Everything else — paging, filtering, attaching outputs — is
 * mechanical, and is tested because it is easy to get subtly wrong, not because
 * getting it wrong is dangerous.
 */

interface SeededJob {
  jobId: string;
  variantId: string;
}

/** A model row plus the feature it serves, so a job can name both. */
async function anyVariant(tx: Sql, modality: "image" | "video" = "image") {
  const [row] = await tx<{ id: string; variant_id: string; family: string; feature_id: string }[]>`
    select model.id, model.capabilities -> 'variant' ->> 'id' as variant_id, model.family, route.feature_id
    from provider_models model
    join feature_model_routes route on route.provider_model_id = model.id
    join features feature on feature.id = route.feature_id
    where model.capabilities ? 'variant' and model.is_active and feature.modality = ${modality}
    limit 1
  `;
  if (!row) throw new Error(`the seeded catalogue has no active ${modality} variant`);
  return row;
}

/**
 * A finished generation with a file attached.
 *
 * Inserted directly rather than driven through quote-and-submit: this suite is
 * about reading, and building six jobs through the whole billing path would
 * test the billing path six more times and this one no better.
 */
async function seedJob(
  tx: Sql,
  options: { accountId: string; userId: string; status?: string; modality?: "image" | "video"; outputs?: number; prompt?: string },
): Promise<SeededJob> {
  const model = await anyVariant(tx, options.modality ?? "image");
  const status = options.status ?? "succeeded";
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (account_id, created_by, feature_id, provider_model_id, params, status, origin, micro_credits_held, micro_credits_charged, completed_at)
    values (
      ${options.accountId}, ${options.userId}, ${model.feature_id}, ${model.id},
      ${tx.json({ prompt: options.prompt ?? "a small red boat" })}, ${status}, 'web',
      ${2 * COIN}, ${status === "succeeded" ? 2 * COIN : 0},
      ${status === "succeeded" || status === "failed" ? tx`now()` : null}
    )
    returning id
  `;
  for (let index = 0; index < (options.outputs ?? 0); index += 1) {
    await tx`
      insert into assets (account_id, created_by, kind, origin, job_id, output_index, storage_provider, storage_bucket, storage_key, mime_type, byte_size, sha256)
      values (
        ${options.accountId}, ${options.userId}, 'image', 'generated', ${job!.id}, ${index},
        's3', 'vgen', ${`generated/${options.accountId}/${job!.id}/${index}.png`}, 'image/png', 4096, ${`hash-${job!.id}-${index}`}
      )
    `;
  }
  return { jobId: job!.id, variantId: model.variant_id };
}

describe("reading one generation", () => {
  it("names the variant the customer picked and attaches its files", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const seeded = await seedJob(tx, { accountId, userId, outputs: 2, prompt: "a lighthouse" });

      const record = await new PostgresGalleryRepository(tx).getForUser(seeded.jobId, userId);

      expect(record).not.toBeNull();
      expect(record!.variantId).toBe(seeded.variantId);
      expect(record!.familyId).toBeTruthy();
      expect(record!.prompt).toBe("a lighthouse");
      expect(record!.coins).toBe(2);
      expect(record!.outputs).toHaveLength(2);
      // Keys, not URLs. Signing is the application layer's job, and this
      // package has no object store in it.
      expect(record!.outputs[0]!.bucket).toBe("vgen");
      expect(record!.outputs[0]!.key).toContain(seeded.jobId);
      expect(record!.outputs[0]!.externalUrl).toBeNull();
    });
  });

  it("does not admit that somebody else's generation exists", async () => {
    await inRollback(sql, async (tx) => {
      const owner = await makeUser(tx);
      const stranger = await makeUser(tx);
      const seeded = await seedJob(tx, { accountId: owner.accountId, userId: owner.userId, outputs: 1 });

      expect(await new PostgresGalleryRepository(tx).getForUser(seeded.jobId, stranger.userId)).toBeNull();
    });
  });

  it("reports the charge once a job is over, and the hold while it runs", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const running = await seedJob(tx, { accountId, userId, status: "running" });
      const failed = await seedJob(tx, { accountId, userId, status: "failed" });
      const gallery = new PostgresGalleryRepository(tx);

      // Held while in flight — the honest answer to "what is this costing me".
      expect((await gallery.getForUser(running.jobId, userId))!.coins).toBe(2);
      // Zero afterwards, because every failure is refunded in full.
      expect((await gallery.getForUser(failed.jobId, userId))!.coins).toBe(0);
    });
  });
});

describe("paging a gallery", () => {
  it("returns the account's generations newest first", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const first = await seedJob(tx, { accountId, userId });
      const second = await seedJob(tx, { accountId, userId });

      const page = await new PostgresGalleryRepository(tx).listForUser(userId);

      // uuid v7 sorts by creation time, which is why the cursor needs no
      // second column and why this order is stable.
      expect(page.items.map((item) => item.id)).toEqual([second.jobId, first.jobId]);
      expect(page.nextCursor).toBeUndefined();
    });
  });

  it("walks the whole list through the cursor without repeating or skipping", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const seeded: string[] = [];
      for (let index = 0; index < 5; index += 1) seeded.push((await seedJob(tx, { accountId, userId })).jobId);

      const gallery = new PostgresGalleryRepository(tx);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await gallery.listForUser(userId, { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...result.items.map((item) => item.id));
        cursor = result.nextCursor;
        if (!cursor) break;
      }

      // Every row exactly once, which is the claim in the name of this test and
      // the only thing keyset paging can actually guarantee.
      expect(new Set(seen).size).toBe(5);
      expect([...seen].sort()).toEqual([...seeded].sort());
      expect(cursor).toBeUndefined();

      // Newest first, by the same key the cursor walks. This used to assert
      // insertion order, which is not the same thing and failed roughly one run
      // in ten: job ids are UUIDv7, and two rows created inside the same
      // millisecond are ordered by the random bits below the timestamp, not by
      // which was inserted first. The pagination was never wrong — `job.id <
      // cursor` over a unique column cannot skip or repeat — the expectation
      // was.
      expect(seen).toEqual([...seen].sort().reverse());
    });
  });

  it("says there is more only when there is", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await seedJob(tx, { accountId, userId });
      await seedJob(tx, { accountId, userId });
      const gallery = new PostgresGalleryRepository(tx);

      expect((await gallery.listForUser(userId, { limit: 1 })).nextCursor).toBeDefined();
      expect((await gallery.listForUser(userId, { limit: 2 })).nextCursor).toBeUndefined();
    });
  });

  it("filters by what was made, not by what the family is called", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await seedJob(tx, { accountId, userId, modality: "image" });
      const video = await seedJob(tx, { accountId, userId, modality: "video" });

      const page = await new PostgresGalleryRepository(tx).listForUser(userId, { kind: "video" });

      // Read off the job's feature rather than the family, because a family's
      // kind is not its variants' modality — topaz is an image family whose
      // second variant produces video.
      expect(page.items.map((item) => item.id)).toEqual([video.jobId]);
    });
  });

  it("never shows one account another account's work", async () => {
    await inRollback(sql, async (tx) => {
      const owner = await makeUser(tx);
      const stranger = await makeUser(tx);
      await seedJob(tx, { accountId: owner.accountId, userId: owner.userId, outputs: 1 });

      expect((await new PostgresGalleryRepository(tx).listForUser(stranger.userId)).items).toEqual([]);
    });
  });

  it("leaves drafts out — a draft was never submitted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await seedJob(tx, { accountId, userId, status: "draft" });
      const kept = await seedJob(tx, { accountId, userId });

      const page = await new PostgresGalleryRepository(tx).listForUser(userId);

      expect(page.items.map((item) => item.id)).toEqual([kept.jobId]);
    });
  });
});

describe("keeping an uploaded reference", () => {
  const upload = (accountId: string, userId: string, sha256: string) => ({
    accountId,
    createdBy: userId,
    kind: "image" as const,
    bucket: "vgen",
    key: `uploads/${accountId}/${sha256}.png`,
    mimeType: "image/png",
    byteSize: 2048,
    sha256,
  });

  it("hands back the same asset when the same bytes arrive again", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const assets = new PostgresAssetsRepository(tx);

      const first = await assets.record(upload(accountId, userId, "deadbeef"));
      const again = await assets.findByHash(accountId, "deadbeef");

      // The saving that matters is the upload, not the row: this answer is
      // what lets the second attempt skip the transfer entirely.
      expect(again?.id).toBe(first.id);
      expect(again?.deduplicated).toBe(true);
    });
  });

  it("does not let one account's upload become another's asset", async () => {
    await inRollback(sql, async (tx) => {
      const owner = await makeUser(tx);
      const stranger = await makeUser(tx);
      const assets = new PostgresAssetsRepository(tx);
      await assets.record(upload(owner.accountId, owner.userId, "cafebabe"));

      // A global dedupe would be cheaper still, and would also mean handing
      // one customer an asset id belonging to another. That is a leak, not a
      // saving.
      expect(await assets.findByHash(stranger.accountId, "cafebabe")).toBeNull();
    });
  });

  it("resolves the account a user spends from", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const assets = new PostgresAssetsRepository(tx);

      expect(await assets.accountFor(userId)).toBe(accountId);
      expect(await assets.accountFor("00000000-0000-4000-8000-00000000dead")).toBeNull();
    });
  });
});
