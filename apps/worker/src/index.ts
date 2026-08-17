import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import postgres from "postgres";
import { createGenerationProvider } from "@vgen/adapters";
import { PostgresJobRunnerRepository, PostgresOutboxDispatcher } from "@vgen/db";
import { BullGenerationPublisher } from "./outboxConsumer";
import { runGeneration } from "./runGeneration";

export const GENERATION_QUEUE = "generation" as const;

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function redisConnection(urlValue: string) {
  const url = new URL(urlValue);
  const database = Number(url.pathname.slice(1) || "0");
  if (!Number.isInteger(database) || database < 0) throw new Error("REDIS_URL database must be a non-negative integer");
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: database,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

const connection = redisConnection(process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379");
const sql = postgres(required("DATABASE_URL"), { max: 4 });
const queue = new Queue(GENERATION_QUEUE, { connection });
const publisher = new BullGenerationPublisher({
  add: (name, data, options) => queue.add(name, data, options as JobsOptions),
});
const dispatcher = new PostgresOutboxDispatcher(sql);
const runnerRepository = new PostgresJobRunnerRepository(sql);

const log = (event: Record<string, unknown>) => console.info(JSON.stringify(event));

let dispatching = false;
async function dispatch(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    const result = await dispatcher.dispatchBatch(publisher);
    if (result.published || result.failed) log({ event: "outbox.dispatch", ...result });
  } catch (error) {
    console.error(JSON.stringify({ event: "outbox.dispatch_failed", error: error instanceof Error ? error.message : "unknown" }));
  } finally {
    dispatching = false;
  }
}

const interval = setInterval(() => void dispatch(), 500);
void dispatch();

/**
 * The other half: what the outbox dispatcher publishes, this consumes.
 *
 * `concurrency` here is a worker-process limit, not an account's and not a
 * provider's. An account's ceiling is enforced at submission time against its
 * plan; a provider's is enforced by the credential pool, which hands out one
 * account at a time and prefers the idlest. This number only bounds how many
 * long polls one Node process holds open at once.
 */
const worker = new Worker(
  GENERATION_QUEUE,
  async (job: Job<{ jobId?: string }>) => {
    const jobId = job.data?.jobId;
    if (!jobId) throw new Error("generation job payload has no jobId");

    const attempts = job.opts.attempts ?? 1;
    const result = await runGeneration(jobId, {
      runner: runnerRepository,
      createProvider: createGenerationProvider,
      secrets: process.env,
      // attemptsMade is the count *before* this one, so this is the last try
      // when there are no further deliveries left after it.
      isFinalAttempt: job.attemptsMade + 1 >= attempts,
      log,
    });

    // The queue only understands "done" and "threw". A retryable failure has
    // deliberately settled nothing, so it has to come back out as a throw or
    // the job is silently abandoned mid-flight with its hold still standing.
    if (result.outcome === "retry") throw new Error(result.reason);
    return result;
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? "8") },
);

worker.on("failed", (job, error) => {
  console.error(
    JSON.stringify({ event: "generation.attempt_failed", jobId: job?.data?.jobId, attempts: job?.attemptsMade, error: error.message }),
  );
});

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  await worker.close();
  await queue.close();
  await sql.end();
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
