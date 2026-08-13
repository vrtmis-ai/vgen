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
import { ClerkCustomerSessionService, FastifyClerkPrincipalResolver } from "./customerSession";
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
const clerkSecretKey = required("CLERK_SECRET_KEY");
const clerkPublishableKey = required("CLERK_PUBLISHABLE_KEY");
const webOrigin = process.env.WEB_ORIGIN?.trim() || "http://127.0.0.1:5180";
const trustProxy = process.env.TRUST_PROXY?.trim();
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
const customerSession = new ClerkCustomerSessionService(new FastifyClerkPrincipalResolver(), new PostgresCustomerRepository(sql));
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
    clerk: { secretKey: clerkSecretKey, publishableKey: clerkPublishableKey },
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
