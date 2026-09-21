import { describe, expect, it } from "vitest";
import { defaultInput, FAMILIES, variantControls } from "../../data/models";
import { createDemoServices } from "./demoServices";

describe("demo generation adapter", () => {
  it("advances one idempotent job through deterministic states", async () => {
    let now = 1_000;
    const services = createDemoServices({ now: () => now });
    const family = FAMILIES[0]!;
    const variant = family.variants[0]!;
    const quote = await services.generation.quote({
      familyId: family.id,
      variantId: variant.id,
      prompt: "A cinematic sunrise",
      input: defaultInput(variantControls(family, variant)),
      referenceAssetIds: {},
    });

    const request = {
      quoteId: quote.id,
      idempotencyKey: "demo-idempotency-key-0001",
      input: defaultInput(variantControls(family, variant)),
      prompt: "A cinematic sunrise",
    };
    const queued = await services.generation.create(request);
    const duplicate = await services.generation.create(request);
    expect(duplicate.id).toBe(queued.id);
    expect(queued.status).toBe("queued");

    now += 500;
    const running = await services.generation.getJob(queued.id);
    expect(running.status).toBe("running");
    expect(running.outputs).toEqual([]);

    now += 2_500;
    // `succeeded`, not `done` — demo mode speaks the database's vocabulary, or
    // a screen built against it is built against a fiction.
    const finished = await services.generation.getJob(queued.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.outputs).toHaveLength(1);
    expect(finished.urlsExpireAt).toBeGreaterThan(now);
  });

  /* The jobs live in memory and the list naming them lives in localStorage, so
     every reload left stored generations pointing at jobs the demo had
     forgotten. The provider polls a finished one again when its link expires,
     the question threw, and the page flickered between itself and a full-page
     503 — rebuilding the form under whoever was typing. */
  describe("across a reload", () => {
    async function submit(services: ReturnType<typeof createDemoServices>) {
      const family = FAMILIES[0]!;
      const variant = family.variants[0]!;
      const input = defaultInput(variantControls(family, variant));
      const quote = await services.generation.quote({
        familyId: family.id,
        variantId: variant.id,
        prompt: "p",
        input,
        referenceAssetIds: {},
      });
      return services.generation.create({ quoteId: quote.id, idempotencyKey: "demo-idempotency-key-0002", input, prompt: "p" });
    }

    it("still answers for a job an earlier page load made", async () => {
      let now = 1_000;
      const job = await submit(createDemoServices({ now: () => now }));

      now += 500;
      const reloaded = createDemoServices({ now: () => now });
      // Where the job had got to by then, not a fresh start.
      expect((await reloaded.generation.getJob(job.id)).status).toBe("running");

      now += 60 * 60_000;
      const later = await reloaded.generation.getJob(job.id);
      expect(later.status).toBe("succeeded");
      expect(later.outputs).toHaveLength(1);
    });

    it("answers an id from before ids carried their start, as long finished", async () => {
      const services = createDemoServices({ now: () => 5_000 });

      await expect(services.generation.getJob("demo-job-2")).resolves.toMatchObject({ status: "succeeded" });
      // Recalled to answer a poll, not listed: it has no model and no prompt,
      // and the history merge would lay that over the local row that has both.
      expect((await services.gallery.list()).items).toEqual([]);
    });

    it("refuses an id it could never have made, as the API does", async () => {
      const services = createDemoServices();

      await expect(services.generation.getJob("not-a-demo-job")).rejects.toMatchObject({ code: "job_not_found", status: 404 });
    });
  });
});
