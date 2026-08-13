import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ReadinessSchema, type Readiness } from "@vgen/contracts";
import { registerErrorHandling } from "./plugins/errors";
import { registerCustomerSessionRoute, type CustomerSessionApplication } from "./routes/session";
import { registerCatalogRoute, type CustomerCatalogApplication } from "./routes/catalog";
import { registerWalletRoute, type CustomerWalletApplication } from "./routes/wallet";
import { registerGenerationJobsRoute, type GenerationJobsApplication } from "./routes/jobs";
import { clerkPlugin, type ClerkFastifyOptions } from "@clerk/fastify";
import cors from "@fastify/cors";
import {
  registerFrontendTelemetryRoute,
  type FrontendTelemetryApplication,
  type TelemetryRateLimiter,
  type TelemetryRateLimitOptions,
} from "./routes/telemetry";

export interface HealthDependency {
  ping(): Promise<void>;
}

export interface ApiDependencies {
  database: HealthDependency;
  redis: HealthDependency;
  storage: HealthDependency;
  customerSession: CustomerSessionApplication;
  customerWallet: CustomerWalletApplication;
  customerCatalog: CustomerCatalogApplication;
  frontendTelemetry: FrontendTelemetryApplication;
  generationJobs: GenerationJobsApplication;
}

export interface ApiOptions {
  clerk?: ClerkFastifyOptions;
  corsOrigin?: string;
  logger?: boolean;
  telemetryRateLimit?: TelemetryRateLimitOptions;
  telemetryRateLimiter?: TelemetryRateLimiter;
  trustProxy?: FastifyServerOptions["trustProxy"];
}

export function createApp(dependencies: ApiDependencies, options: ApiOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
  });
  registerErrorHandling(app);
  if (options.corsOrigin) {
    void app.register(cors, { origin: options.corsOrigin, credentials: true });
  }
  if (options.clerk) void app.register(clerkPlugin, options.clerk);
  registerCustomerSessionRoute(app, dependencies.customerSession);
  registerCatalogRoute(app, dependencies.customerCatalog);
  registerWalletRoute(app, dependencies.customerSession, dependencies.customerWallet);
  registerFrontendTelemetryRoute(app, dependencies.frontendTelemetry, options.telemetryRateLimit, options.telemetryRateLimiter);
  registerGenerationJobsRoute(app, dependencies.customerSession, dependencies.generationJobs);

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const names = ["database", "redis", "storage"] as const;
    const settled = await Promise.allSettled(names.map((name) => dependencies[name].ping()));
    const health = Object.fromEntries(names.map((name, index) => [name, settled[index]?.status === "fulfilled" ? "up" : "down"]));
    const readiness = ReadinessSchema.parse({
      status: Object.values(health).every((value) => value === "up") ? "ready" : "degraded",
      dependencies: health,
    }) satisfies Readiness;
    return reply.code(readiness.status === "ready" ? 200 : 503).send(readiness);
  });

  return app;
}
