import { describe, expect, it, vi } from "vitest";
import { BullGenerationPublisher } from "./outboxConsumer";

describe("BullMQ generation publisher", () => {
  it("uses the outbox row as the stable BullMQ job id", async () => {
    const add = vi.fn(async () => undefined);
    const publisher = new BullGenerationPublisher({ add });

    await publisher.publish({
      id: "42",
      aggregate: "job",
      aggregateId: "11111111-1111-4111-8111-111111111111",
      eventType: "generation.requested",
      payload: { jobId: "11111111-1111-4111-8111-111111111111" },
      attempts: 0,
    });

    expect(add).toHaveBeenCalledWith(
      "generate",
      { jobId: "11111111-1111-4111-8111-111111111111" },
      expect.objectContaining({ jobId: "outbox-42", attempts: 5, backoff: { type: "exponential", delay: 2_000 } }),
    );
  });
});
