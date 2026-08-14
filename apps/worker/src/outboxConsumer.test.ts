import { describe, expect, it, vi } from "vitest";
import { BullGenerationPublisher } from "./outboxConsumer";

describe("BullMQ generation publisher", () => {
  it("uses the outbox row as the stable BullMQ job id", async () => {
    const add = vi.fn(async () => undefined);
    const publisher = new BullGenerationPublisher({ add });

    await publisher.publish({
      id: "42",
      topic: "generation.requested",
      payload: { jobId: "11111111-1111-4111-8111-111111111111" },
      attempts: 0,
    });

    expect(add).toHaveBeenCalledWith(
      "generate",
      { jobId: "11111111-1111-4111-8111-111111111111" },
      expect.objectContaining({ jobId: "outbox-42", attempts: 5, backoff: { type: "exponential", delay: 2_000 } }),
    );
  });

  it("refuses a topic it does not know how to route", async () => {
    // The queue carries one kind of work. Publishing anything else would enqueue
    // a job no consumer understands, which fails silently on the far side.
    const add = vi.fn(async () => undefined);
    const publisher = new BullGenerationPublisher({ add });

    await expect(publisher.publish({ id: "43", topic: "post.published", payload: {}, attempts: 0 })).rejects.toThrow(
      /Unsupported outbox topic/,
    );
    expect(add).not.toHaveBeenCalled();
  });
});
