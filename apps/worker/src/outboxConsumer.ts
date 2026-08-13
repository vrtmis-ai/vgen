import type { OutboxEvent, OutboxPublisher } from "@vgen/db";

export interface BullQueuePort {
  add(name: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

export class BullGenerationPublisher implements OutboxPublisher {
  constructor(private readonly queue: BullQueuePort) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.aggregate !== "job" || event.eventType !== "generation.requested") {
      throw new Error(`Unsupported outbox event: ${event.aggregate}.${event.eventType}`);
    }
    await this.queue.add("generate", event.payload, {
      jobId: `outbox-${event.id}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 10_000 },
      removeOnFail: { count: 10_000 },
    });
  }
}
