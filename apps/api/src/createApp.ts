import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { OAuthProviderSchema, ReadinessSchema, type Readiness } from "@vgen/contracts";
import { registerErrorHandling } from "./plugins/errors";
import { registerCustomerSessionRoute, type CustomerSessionApplication } from "./routes/session";
import { registerCatalogRoute, type CustomerCatalogApplication } from "./routes/catalog";
import { registerContentRoute, type CustomerContentApplication } from "./routes/content";
import { registerCommunityRoute, type CustomerCommunityApplication } from "./routes/community";
import { registerPlansRoute, type CustomerPlansApplication } from "./routes/plans";
import { registerWalletRoute, type CustomerWalletApplication } from "./routes/wallet";
import { registerGenerationJobsRoute, type GenerationJobsApplication } from "./routes/jobs";
import { registerGenerationQuotesRoute, type GenerationQuotesApplication } from "./routes/quotes";
import { registerGalleryRoute } from "./routes/gallery";
import { registerAssetUploadRoute, type AssetUploadApplication } from "./routes/assets";
import type { GenerationLibraryApplication } from "./generationLibrary";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { UPLOAD_MAX_BYTES } from "@vgen/contracts";
import {
  registerFrontendTelemetryRoute,
  type FrontendTelemetryApplication,
  type TelemetryRateLimiter,
  type TelemetryRateLimitOptions,
} from "./routes/telemetry";
import { registerAuthRoutes, type AuthDependencies, type AuthRouteOptions } from "./routes/auth";
import { registerAdminRoutes, type AdminDependencies, type AdminRouteOptions } from "./routes/admin";

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
  customerContent: CustomerContentApplication;
  customerCommunity: CustomerCommunityApplication;
  customerPlans: CustomerPlansApplication;
  frontendTelemetry: FrontendTelemetryApplication;
  generationJobs: GenerationJobsApplication;
  generationQuotes: GenerationQuotesApplication;
  generationLibrary: GenerationLibraryApplication;
  assetUploads: AssetUploadApplication;
}

export interface ApiOptions {
  corsOrigin?: string;
  logger?: boolean;
  telemetryRateLimit?: TelemetryRateLimitOptions;
  telemetryRateLimiter?: TelemetryRateLimiter;
  trustProxy?: FastifyServerOptions["trustProxy"];
  /**
   * Absent in tests that only exercise the customer surface. When absent the
   * auth routes are simply not registered — there is no half-configured mode
   * where signup exists but cannot issue a session.
   */
  auth?: { dependencies: AuthDependencies; options: AuthRouteOptions } | undefined;
  /** Absent in tests of the customer surface; the staff routes are then simply not mounted. */
  admin?: { dependencies: AdminDependencies; options: AdminRouteOptions } | undefined;
}

export function createApp(dependencies: ApiDependencies, options: ApiOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
  });
  registerErrorHandling(app);
  if (options.corsOrigin) {
    // `methods` is spelled out because @fastify/cors defaults to
    // `GET,HEAD,POST` — not the fuller list most CORS middleware uses. Every
    // PUT, PATCH and DELETE this API serves was therefore refused at the
    // preflight from a browser on the web origin, which is every write the
    // admin panel makes: saving a route list, toggling a provider, revoking an
    // invite, signing out. It was invisible from curl and from the tests,
    // because neither sends a preflight.
    void app.register(cors, {
      origin: options.corsOrigin,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
  }
  // The ceiling is set here as well as checked in the route. This one refuses
  // the connection; the route's turns a truncated file into a clear 413 rather
  // than a corrupt object.
  void app.register(multipart, { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });
  if (options.auth) registerAuthRoutes(app, options.auth.dependencies, options.auth.options);
  if (options.admin) registerAdminRoutes(app, options.admin.dependencies, options.admin.options);

  // Derived from the same object `registerAuthRoutes` reads, so the list the
  // browser is told and the routes that exist are the same fact. A provider
  // whose credentials are unset has no endpoint, and now no button either.
  const authOptions = options.auth?.options;
  const authProviders = authOptions ? OAuthProviderSchema.options.filter((provider) => authOptions[provider]) : [];
  registerCustomerSessionRoute(app, dependencies.customerSession, authProviders);
  registerCatalogRoute(app, dependencies.customerCatalog);
  registerContentRoute(app, dependencies.customerContent);
  registerCommunityRoute(app, dependencies.customerCommunity);
  registerPlansRoute(app, dependencies.customerPlans);
  registerWalletRoute(app, dependencies.customerSession, dependencies.customerWallet);
  registerFrontendTelemetryRoute(app, dependencies.frontendTelemetry, options.telemetryRateLimit, options.telemetryRateLimiter);
  registerGenerationQuotesRoute(app, dependencies.customerSession, dependencies.generationQuotes);
  registerGenerationJobsRoute(app, dependencies.customerSession, dependencies.generationJobs, dependencies.generationLibrary);
  registerGalleryRoute(app, dependencies.customerSession, dependencies.generationLibrary);
  registerAssetUploadRoute(app, dependencies.customerSession, dependencies.assetUploads);

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
