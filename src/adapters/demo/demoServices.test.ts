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

    const request = { quoteId: quote.id, idempotencyKey: "demo-idempotency-key-0001" };
    const queued = await services.generation.create(request);
    const duplicate = await services.generation.create(request);
    expect(duplicate.id).toBe(queued.id);
    expect(queued.status).toBe("queued");

    now += 500;
    const running = await services.generation.getJob(queued.id);
    expect(running.status).toBe("running");
    expect(running.progress).toBeGreaterThan(0);

    now += 2_500;
    const done = await services.generation.getJob(queued.id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
  });
});
