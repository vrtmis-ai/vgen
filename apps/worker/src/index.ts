import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Queue, type JobsOptions } from "bullmq";
import postgres from "postgres";
import { PostgresOutboxDispatcher } from "@vgen/db";
import { BullGenerationPublisher } from "./outboxConsumer";

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

const sql = postgres(required("DATABASE_URL"), { max: 2 });
const queue = new Queue(GENERATION_QUEUE, { connection: redisConnection(process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379") });
const publisher = new BullGenerationPublisher({
  add: (name, data, options) => queue.add(name, data, options as JobsOptions),
});
const dispatcher = new PostgresOutboxDispatcher(sql);

let dispatching = false;
async function dispatch(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    const result = await dispatcher.dispatchBatch(publisher);
    if (result.published || result.failed) console.info(JSON.stringify({ event: "outbox.dispatch", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "outbox.dispatch_failed", error: error instanceof Error ? error.message : "unknown" }));
  } finally {
    dispatching = false;
  }
}

const interval = setInterval(() => void dispatch(), 500);
void dispatch();

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  await queue.close();
  await sql.end();
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
