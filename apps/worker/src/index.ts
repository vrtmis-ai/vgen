import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import postgres from "postgres";
import { createGenerationProvider, createS3ObjectStore } from "@vgen/adapters";
import { PostgresJobRunnerRepository, PostgresOutboxDispatcher } from "@vgen/db";
import { BullGenerationPublisher } from "./outboxConsumer";
import { FX_CHECK_INTERVAL_MS, refreshFxRate } from "./fxRefresh";
import { HttpOutputMirror } from "./outputMirror";
import { isLoopbackUrl, runGeneration, WORKER_LOST } from "./runGeneration";

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

/**
 * Where finished generations are kept.
 *
 * `forcePathStyle` and these defaults are the local MinIO in docker-compose.
 * In production the endpoint moves, and one more thing moves with it.
 *
 * This used to say the store was reachable only from the API and this worker.
 * That was never quite true and is plainly false now: `signReference` below
 * hands a signed URL to the generation PROVIDER, which fetches it from its own
 * servers on the public internet. A private endpoint therefore produces a URL
 * nobody outside can resolve, and every reference-based generation fails in a
 * way that looks like the provider misbehaving. `OBJECT_STORAGE_PUBLIC_ENDPOINT`
 * is the name those URLs carry; the connection stays on the private one.
 */
const objectStore = createS3ObjectStore({
  bucket: process.env.OBJECT_STORAGE_BUCKET?.trim() || "vgen",
  publicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim(),
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT?.trim() || "http://127.0.0.1:9000",
  region: process.env.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
  credentials: {
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY?.trim() || "vgen-local",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY?.trim() || "vgen-local-secret",
  },
});
const mirror = new HttpOutputMirror({ store: objectStore });

const log = (event: Record<string, unknown>) => console.info(JSON.stringify(event));

/* Say, on every boot, the one setting that decides whether a generation with an
   attachment can work at all.

   It is read from the environment, applies only to jobs carrying a file, and
   fails them in a way that looks like the provider's fault — so an unset or
   stale value is invisible until somebody spends a real generation finding out.
   Diagnosing that from the outside took three rounds once; a line in the log
   costs nothing and makes it the first thing anyone sees. */
const referenceHost =
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim() || process.env.OBJECT_STORAGE_ENDPOINT?.trim() || "http://127.0.0.1:9000";
log({
  event: "worker.reference_host",
  host: referenceHost,
  // The same rule `isLoopbackUrl` applies per job, stated once at startup.
  reachableByProviders: !isLoopbackUrl(referenceHost),
});

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

/* The day's USD/Toman rate.
 *
 * Asked hourly, acted on daily: `refreshFxRate` reads how old the live rate is
 * and does nothing until it is due, so the schedule survives a restart without
 * a cron table to keep in step and without refreshing on every deploy.
 *
 * Every failure is a log line and nothing else. A source that is unreachable
 * leaves yesterday's rate live, which is the safe outcome — a price one day
 * stale is not a price that is wrong — and an implausible one is refused on
 * purpose. Both repeat next hour. */
async function refreshRate(): Promise<void> {
  try {
    const result = await refreshFxRate(sql);
    if (result.outcome === "not_due") return;
    const line = { event: "fx.refresh", ...result };
    if (result.outcome === "written" || result.outcome === "unchanged") log(line);
    else console.error(JSON.stringify(line));
  } catch (error) {
    console.error(JSON.stringify({ event: "fx.refresh_failed", error: messageOf(error) }));
  }
}
const fxInterval = setInterval(() => void refreshRate(), FX_CHECK_INTERVAL_MS);
void refreshRate();

// A fresh volume has no bucket, and discovering that on the first successful
// generation would fail a job somebody paid for.
void objectStore.ensureBucket().catch((error) => {
  console.error(JSON.stringify({ event: "storage.bucket_unavailable", error: error instanceof Error ? error.message : "unknown" }));
});

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
      mirror,
      secrets: process.env,
      // Signed here, per attempt. The default expiry is the store's, which is
      // measured against how long a provider takes to fetch what it was handed
      // rather than against how long the job sat in the queue.
      signReference: (key) => objectStore.signedUrl(key),
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

/**
 * The queue has given up on a delivery — and may have given up on the job.
 *
 * This only logged, and that was a hole with money in it. `jobs.status` is
 * written to a terminal value in exactly three places, all inside
 * `runGeneration`'s own `settle()`/`succeed()`. When BullMQ fails a job on its
 * own — a worker killed mid-poll and found stalled more times than
 * `maxStalledCount` allows — the processor never runs again, so nothing ever
 * settles the row: it stays `running` forever with the customer's coins held
 * against it, and no reaper, lease or heartbeat exists anywhere to find it.
 *
 * `hasNextAttempt` is the guard that keeps an ordinary retry from being settled
 * early: a delivery that will be redelivered has not failed, the attempt has.
 *
 * `fail()` is safe to call either way — it takes the row lock and returns
 * without touching anything unless the job is still `queued` or `running`, so
 * a race with a processor that settled first cannot double-refund.
 */
worker.on("failed", (job, error) => {
  const jobId = job?.data?.jobId;
  const attempts = job?.opts.attempts ?? 1;
  const hasNextAttempt = job !== undefined && job.attemptsMade < attempts;
  console.error(
    JSON.stringify({
      event: "generation.attempt_failed",
      jobId,
      attempts: job?.attemptsMade,
      settling: !hasNextAttempt,
      error: error.message,
    }),
  );
  if (!jobId || hasNextAttempt) return;
  void runnerRepository.fail(jobId, WORKER_LOST, "This generation was interrupted and did not finish.").catch((failure: unknown) => {
    // Nothing else will try: this is the last line between a stalled job and a
    // hold that never returns, so a failure here is worth its own log line.
    console.error(JSON.stringify({ event: "generation.settle_failed", jobId, error: messageOf(failure) }));
  });
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  clearInterval(fxInterval);
  await worker.close();
  await queue.close();
  await sql.end();
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
