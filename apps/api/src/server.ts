import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import {
  PostgresAccessRepository,
  PostgresAdminRepository,
  PostgresAuthRepository,
  PostgresCatalogRepository,
  PostgresFrontendTelemetryRepository,
  PostgresGenerationRepository,
  PostgresWalletRepository,
} from "@vgen/db";
import { createRedisFixedWindowRateLimiter, createRedisHealthAdapter, createS3StorageHealthAdapter } from "@vgen/adapters";
import { CustomerSessionService, SessionCookiePrincipalResolver } from "./customerSession";
import { sealingKeyFrom } from "@vgen/core";
import { createAuthRateLimiters } from "./auth/rateLimits";
import { GoogleOAuth } from "./auth/googleOAuth";
import { ConsoleSmsSender, KavenegarSmsSender, type SmsSender } from "./auth/sms";
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
// Salts the phone hash in trial_grants, which outlives the account it belonged
// to. Without a pepper that table is an enumerable list of everyone who has
// ever signed up — the mobile number space is small enough to walk completely.
// Changing it re-opens the free trial for every existing number, so it is a
// deploy-once value.
const phonePepper = infrastructureSetting("PHONE_HASH_PEPPER", "deev-local-phone-pepper");
const port = Number(process.env.API_PORT ?? "5181");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("API_PORT must be a valid TCP port");

const sql = postgres(databaseUrl, { max: 10 });

/**
 * Google is optional: it needs credentials, and for most Iranian users it needs
 * a VPN to reach at all. Phone OTP is the route that works, so a missing Google
 * client disables that one endpoint rather than failing the boot.
 */
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const google =
  googleClientId && googleClientSecret
    ? new GoogleOAuth({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: `${infrastructureSetting("API_PUBLIC_URL", `http://127.0.0.1:${port}`)}/api/v1/auth/google/callback`,
      })
    : undefined;

const kavenegarKey = process.env.KAVENEGAR_API_KEY?.trim();
const kavenegarTemplate = process.env.KAVENEGAR_TEMPLATE?.trim();
// ConsoleSmsSender refuses to construct in production, so a deploy that forgets
// the gateway fails at boot instead of printing customers' codes into the logs.
const sms: SmsSender =
  kavenegarKey && kavenegarTemplate
    ? new KavenegarSmsSender({ apiKey: kavenegarKey, template: kavenegarTemplate })
    : new ConsoleSmsSender();

// Seals TOTP secrets at rest, so `mfa_credentials.secret_ref` is a blob that
// is useless without a key held outside the database.
const mfaSealingKey = sealingKeyFrom(infrastructureSetting("MFA_SEALING_KEY", "deev-local-mfa-key"));
const authRepository = new PostgresAuthRepository(sql, phonePepper);
const adminRepository = new PostgresAdminRepository(sql, mfaSealingKey);
const accessRepository = new PostgresAccessRepository(sql);
const authRateLimiters = await createAuthRateLimiters(sql, redisUrl, rateLimitHashSecret);
const telemetryRateLimiter = createRedisFixedWindowRateLimiter(redisUrl, {
  max: 20,
  windowMs: 60_000,
  keyPrefix: "deev:rate-limit:telemetry:v1",
  hashSecret: rateLimitHashSecret,
});
const customerSession = new CustomerSessionService(new SessionCookiePrincipalResolver(authRepository));
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
    admin: {
      dependencies: {
        admin: adminRepository,
        access: accessRepository,
        // Staff prove who they are exactly as customers do; the second factor
        // is what makes it a staff session.
        verifyPassword: async (email, password) => {
          const user = await authRepository.loginWithPassword(email, password);
          return { id: user.id, emailNormalized: user.emailNormalized };
        },
      },
      options: { cookie: { secure: process.env.NODE_ENV === "production" } },
    },
    auth: {
      dependencies: { auth: authRepository, sms },
      options: {
        // Secure everywhere but local http, where the browser would drop it.
        cookie: { secure: process.env.NODE_ENV === "production" },
        limiters: authRateLimiters,
        webOrigin,
        ...(google ? { google } : {}),
      },
    },
  },
);

const close = async () => {
  await app.close();
  telemetryRateLimiter.close();
  authRateLimiters.close();
  await sql.end();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host: "0.0.0.0", port });
