import type { Sql } from "postgres";

export interface OutboxEvent {
  id: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
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

const MAX_ATTEMPTS = 10;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown queue publication error").slice(0, 1_000);
}

export class PostgresOutboxDispatcher {
  constructor(
    private readonly sql: Sql,
    private readonly eventType = "generation.requested",
  ) {}

  async dispatchBatch(publisher: OutboxPublisher, limit = 50): Promise<DispatchBatchResult> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          id: string;
          aggregate: string;
          aggregate_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          attempts: number;
        }[]
      >`
        select id::text as id, aggregate, aggregate_id::text as aggregate_id, event_type, payload, attempts
        from outbox
        where event_type = ${this.eventType}
          and published_at is null and dead_lettered_at is null and available_at <= now()
        order by available_at, id
        for update skip locked
        limit ${safeLimit}
      `;

      let published = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await publisher.publish({
            id: row.id,
            aggregate: row.aggregate,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
            attempts: row.attempts,
          });
          await transaction`
            update outbox set published_at = now(), attempts = attempts + 1, last_error = null where id = ${row.id}
          `;
          published += 1;
        } catch (error) {
          const nextAttempts = row.attempts + 1;
          const delaySeconds = Math.min(300, 2 ** Math.min(nextAttempts, 8));
          await transaction`
            update outbox
            set attempts = ${nextAttempts},
                last_error = ${errorMessage(error)},
                available_at = now() + (${delaySeconds} * interval '1 second'),
                dead_lettered_at = case when ${nextAttempts} >= ${MAX_ATTEMPTS} then now() else null end
            where id = ${row.id}
          `;
          failed += 1;
        }
      }
      return { published, failed };
    }) as Promise<DispatchBatchResult>;
  }
}
