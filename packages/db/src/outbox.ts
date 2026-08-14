import type { Sql } from "postgres";

export interface OutboxEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export interface DispatchBatchResult {
  published: number;
  failed: number;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown queue publication error").slice(0, 1_000);
}

/**
 * Drains the transactional outbox onto the queue.
 *
 * The event shape follows the schema's outbox: a `topic` and a `payload`, where
 * the previous version carried `aggregate` / `aggregate_id` / `event_type` as
 * separate columns. Routing information the consumer needs travels inside the
 * payload now.
 *
 * Dead-lettering is likewise the schema's: a row is retired when `attempts`
 * reaches its own `max_attempts`, rather than by stamping a `dead_lettered_at`
 * column. That makes the retry budget per-row and settable by whoever writes the
 * event, instead of a constant compiled into the dispatcher.
 */
export class PostgresOutboxDispatcher {
  constructor(
    private readonly sql: Sql,
    private readonly topic = "generation.requested",
  ) {}

  async dispatchBatch(publisher: OutboxPublisher, limit = 50): Promise<DispatchBatchResult> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.sql.begin(async (transaction) => {
      /* FOR UPDATE SKIP LOCKED is what makes several worker replicas safe: each
         claims a disjoint batch instead of contending for the same head rows. */
      const rows = await transaction<
        { id: string; topic: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }[]
      >`
        select id::text as id, topic, payload, attempts, max_attempts
        from outbox
        where topic = ${this.topic}
          and processed_at is null
          and attempts < max_attempts
          and available_at <= now()
        order by available_at, id
        for update skip locked
        limit ${safeLimit}
      `;

      let published = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await publisher.publish({ id: row.id, topic: row.topic, payload: row.payload, attempts: row.attempts });
          await transaction`
            update outbox set processed_at = now(), attempts = attempts + 1, last_error = null where id = ${row.id}
          `;
          published += 1;
        } catch (error) {
          // Exponential, capped at five minutes. A queue that is down stays down
          // for a while, and retrying a dead broker every 500ms is just noise.
          const nextAttempts = row.attempts + 1;
          const delaySeconds = Math.min(300, 2 ** Math.min(nextAttempts, 8));
          await transaction`
            update outbox
            set attempts = ${nextAttempts},
                last_error = ${errorMessage(error)},
                available_at = now() + (${delaySeconds} * interval '1 second')
            where id = ${row.id}
          `;
          failed += 1;
        }
      }
      return { published, failed };
    }) as Promise<DispatchBatchResult>;
  }
}
