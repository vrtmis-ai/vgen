import type { OutboxEvent, OutboxPublisher } from "@vgen/db";

export interface BullQueuePort {
  add(name: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

export class BullGenerationPublisher implements OutboxPublisher {
  constructor(private readonly queue: BullQueuePort) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.topic !== "generation.requested") {
      throw new Error(`Unsupported outbox topic: ${event.topic}`);
    }
    /* `outbox-<row id>` is BullMQ's dedupe key, and it is the whole reason a
       crash between this add() and the processed_at update is harmless: the row
       is redelivered, and BullMQ drops the duplicate rather than running the
       generation twice. */
    await this.queue.add("generate", event.payload, {
      jobId: `outbox-${event.id}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 10_000 },
      removeOnFail: { count: 10_000 },
    });
  }
}
