import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import {
  PostgresCatalogRepository,
  PostgresCustomerRepository,
  PostgresFrontendTelemetryRepository,
  PostgresGenerationRepository,
  PostgresWalletRepository,
} from "@vgen/db";
import { createRedisFixedWindowRateLimiter, createRedisHealthAdapter, createS3StorageHealthAdapter } from "@vgen/adapters";
import { AnonymousPrincipalResolver, CustomerSessionService } from "./customerSession";
import { createApp } from "./createApp";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function infrastructureSetting(name: string, localDefault: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV !== "production") return localDefault;
  throw new Error(`${name} is required in production`);
}

const databaseUrl = required("DATABASE_URL");
// Through infrastructureSetting like every other one: this used to fall back to
// the loopback origin unconditionally, so a production deploy that forgot it
// booted healthy with CORS pinned to 127.0.0.1 and every browser request from
// the real domain failed preflight. The API logs stay clean in that state
// because the requests never arrive, which makes it expensive to diagnose.
const webOrigin = infrastructureSetting("WEB_ORIGIN", "http://127.0.0.1:5180");
// Same treatment. The telemetry limiter keys on request.ip, and without
// trustProxy Fastify reports the socket peer — behind nginx or a CDN that is
// the proxy, for everyone, so all users share one 20/min bucket and reports are
// dropped with a 429 nothing surfaces. Must be the exact proxy IP or CIDR;
// `true` on a public API lets a client forge X-Forwarded-For and skip the limit.
const trustProxy = infrastructureSetting("TRUST_PROXY", "");
const redisUrl = infrastructureSetting("REDIS_URL", "redis://127.0.0.1:6379");
const rateLimitHashSecret = infrastructureSetting("RATE_LIMIT_HASH_SECRET", "deev-local-rate-limit-key");
const objectStorageEndpoint = infrastructureSetting("OBJECT_STORAGE_ENDPOINT", "http://127.0.0.1:9000");
const objectStorageRegion = infrastructureSetting("OBJECT_STORAGE_REGION", "us-east-1");
const objectStorageAccessKey = infrastructureSetting("OBJECT_STORAGE_ACCESS_KEY", "vgen-local");
const objectStorageSecretKey = infrastructureSetting("OBJECT_STORAGE_SECRET_KEY", "vgen-local-secret");
const port = Number(process.env.API_PORT ?? "5181");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("API_PORT must be a valid TCP port");

const sql = postgres(databaseUrl, { max: 10 });
const telemetryRateLimiter = createRedisFixedWindowRateLimiter(redisUrl, {
  max: 20,
  windowMs: 60_000,
  keyPrefix: "deev:rate-limit:telemetry:v1",
  hashSecret: rateLimitHashSecret,
});
const customerSession = new CustomerSessionService(new AnonymousPrincipalResolver(), new PostgresCustomerRepository(sql));
const app = createApp(
  {
    database: {
      async ping() {
        await sql`select 1`;
      },
    },
    redis: createRedisHealthAdapter(redisUrl),
    storage: createS3StorageHealthAdapter({
      endpoint: objectStorageEndpoint,
      region: objectStorageRegion,
      forcePathStyle: true,
      credentials: { accessKeyId: objectStorageAccessKey, secretAccessKey: objectStorageSecretKey },
    }),
    customerSession,
    customerWallet: new PostgresWalletRepository(sql),
    customerCatalog: new PostgresCatalogRepository(sql),
    frontendTelemetry: new PostgresFrontendTelemetryRepository(sql),
    generationJobs: new PostgresGenerationRepository(sql),
  },
  {
    corsOrigin: webOrigin,
    logger: true,
    telemetryRateLimiter,
    ...(trustProxy ? { trustProxy } : {}),
  },
);

const close = async () => {
  await app.close();
  telemetryRateLimiter.close();
  await sql.end();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host: "0.0.0.0", port });
