import { describe, expect, it, vi } from "vitest";
import { createApp, type ApiDependencies } from "./createApp";

/** The one shape `POST /jobs`, `GET /jobs/:id` and the gallery all speak. */
function generationJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "running" as const,
    familyId: "flux",
    variantId: "flux-test",
    coins: 30,
    prompt: "a small red boat",
    createdAt: 123,
    updatedAt: 456,
    outputs: [],
    urlsExpireAt: null,
    ...overrides,
  };
}

function healthyDependencies(): ApiDependencies {
  return {
    database: { ping: vi.fn(async () => undefined) },
    redis: { ping: vi.fn(async () => undefined) },
    storage: { ping: vi.fn(async () => undefined) },
    customerSession: {
      getCurrent: vi.fn(async () => ({ status: "anonymous" as const, host: "web" as const })),
    },
    customerPlans: { list: vi.fn(async () => []) },
    customerWallet: {
      getCurrent: vi.fn(async () => ({ spendable: 0, grants: [] })),
    },
    customerCatalog: {
      list: vi.fn(async () => ({ version: "bootstrap-v1", publishedAt: 0, families: [] })),
    },
    frontendTelemetry: {
      record: vi.fn(async () => "report-1"),
    },
    generationJobs: {
      createQueued: vi.fn(async () => ({
        outcome: "created" as const,
        job: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "queued" as const,
          modelKey: "flux-test",
          quotedCredits: 30,
          createdAt: 123,
        },
      })),
    },
    generationLibrary: {
      get: vi.fn(async () => generationJob()),
      list: vi.fn(async () => ({ items: [generationJob()] })),
    },
    assetUploads: {
      upload: vi.fn(async () => ({
        id: "55555555-5555-4555-8555-555555555555",
        url: "https://storage.test/signed/reference.png?sig=1",
        kind: "image" as const,
        mimeType: "image/png",
        byteSize: 8,
        deduplicated: false,
        urlExpiresAt: 1_700_003_600_000,
      })),
    },
    generationQuotes: {
      create: vi.fn(async () => ({
        outcome: "quoted" as const,
        quote: {
          id: "44444444-4444-4444-8444-444444444444",
          coins: 4,
          expiresAt: 1_700_000_000_000,
          concurrency: { running: 0, limit: 3 },
        },
      })),
    },
  };
}

const authedSession = {
  status: "authed" as const,
  host: "web" as const,
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    methods: ["email"] as ["email"],
    emailNormalized: "user@example.test",
    locale: "fa" as const,
    isTeam: false,
  },
};

describe("generation job creation", () => {
  it("creates an authenticated queued job with an idempotency key", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => ({
      status: "authed" as const,
      host: "web" as const,
      user: {
        id: "22222222-2222-4222-8222-222222222222",
        methods: ["email"] as ["email"],
        emailNormalized: "user@example.test",
        locale: "fa" as const,
        isTeam: false,
      },
    }));
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { "idempotency-key": "generate:test-1" },
      payload: { quoteId: "33333333-3333-4333-8333-333333333333", params: { prompt: "a city" } },
    });

    expect(response.statusCode).toBe(202);
    // Read back through the library rather than echoed from the insert, so
    // this route answers in the same shape as the gallery and the job route.
    expect(dependencies.generationLibrary.get).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(response.json()).toMatchObject({ variantId: "flux-test", coins: 30, outputs: [] });
    expect(dependencies.generationJobs.createQueued).toHaveBeenCalledWith({
      userId: "22222222-2222-4222-8222-222222222222",
      quoteId: "33333333-3333-4333-8333-333333333333",
      params: { prompt: "a city" },
      idempotencyKey: "generate:test-1",
    });
    await app.close();
  });

  it("does not create generation jobs for anonymous visitors", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { "idempotency-key": "generate:test-2" },
      payload: { quoteId: "33333333-3333-4333-8333-333333333333", params: {} },
    });

    expect(response.statusCode).toBe(401);
    expect(dependencies.generationJobs.createQueued).not.toHaveBeenCalled();
    await app.close();
  });

  /**
   * Each refusal gets its own code because a client acts on each differently:
   * top up, re-quote, wait, or fix the request. Collapsing them into one 409
   * would leave the UI guessing which.
   */
  it.each([
    ["insufficient_credits", 402],
    ["quote_unavailable", 404],
    ["quote_expired", 410],
    ["quote_spent", 409],
    ["params_mismatch", 409],
    ["idempotency_conflict", 409],
    ["concurrency_reached", 429],
    ["allowance_spent", 409],
  ])("answers %s with %i", async (outcome, status) => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    dependencies.generationJobs.createQueued = vi.fn(async () => ({ outcome }) as never);
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { "idempotency-key": "generate:test-3" },
      payload: { quoteId: "33333333-3333-4333-8333-333333333333", params: {} },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code: outcome } });
    await app.close();
  });
});

describe("reading a generation job", () => {
  it("returns the caller's job", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/generation/jobs/abc" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "running", familyId: "flux", variantId: "flux-test" });
    expect(dependencies.generationLibrary.get).toHaveBeenCalledWith("abc", "22222222-2222-4222-8222-222222222222");
    await app.close();
  });

  // A job id is not a capability: 404, not 403, so the reply does not confirm
  // that somebody else's job exists.
  it("answers 404 when the job is not the caller's", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    dependencies.generationLibrary.get = vi.fn(async () => null);
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/generation/jobs/abc" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("does not serve jobs to anonymous visitors", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/generation/jobs/abc" });
    expect(response.statusCode).toBe(401);
    expect(dependencies.generationLibrary.get).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("the gallery", () => {
  it("returns the caller's generations", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/gallery?limit=10&kind=image" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(dependencies.generationLibrary.list).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", {
      limit: 10,
      kind: "image",
    });
    await app.close();
  });

  it("is not readable without a session", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/gallery" });

    expect(response.statusCode).toBe(401);
    expect(dependencies.generationLibrary.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a limit outside the range rather than clamping it silently", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/gallery?limit=5000" });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("uploading a reference image", () => {
  /** A real PNG header, because the service reads the magic bytes not the header. */
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function multipart(bytes: Buffer, filename = "reference.png", contentType = "image/png") {
    // Built from char codes rather than escapes: multipart is CRLF-delimited
    // and busboy rejects the body outright if a bare LF sneaks in.
    const CRLF = String.fromCharCode(13, 10);
    const boundary = "----deevtest";
    const head = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      "",
    ].join(CRLF);
    const body = Buffer.concat([Buffer.from(head), bytes, Buffer.from(`${CRLF}--${boundary}--${CRLF}`)]);
    return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  }

  it("stores the file and answers with a signed URL", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    const app = createApp(dependencies);
    const { body, headers } = multipart(pngBytes);

    const response = await app.inject({ method: "POST", url: "/api/v1/assets", payload: body, headers });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ kind: "image", mimeType: "image/png", deduplicated: false });
    await app.close();
  });

  it("answers 200 rather than 201 when the same bytes were already here", async () => {
    // The difference is the whole point of hashing: nothing new was stored, so
    // this is not a creation. A client can tell one from the other.
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    dependencies.assetUploads.upload = vi.fn(async () => ({
      id: "55555555-5555-4555-8555-555555555555",
      url: "https://storage.test/signed/reference.png?sig=1",
      kind: "image" as const,
      mimeType: "image/png",
      byteSize: 8,
      deduplicated: true,
      urlExpiresAt: 1_700_003_600_000,
    }));
    const app = createApp(dependencies);
    const { body, headers } = multipart(pngBytes);

    const response = await app.inject({ method: "POST", url: "/api/v1/assets", payload: body, headers });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("refuses an anonymous upload", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);
    const { body, headers } = multipart(pngBytes);

    const response = await app.inject({ method: "POST", url: "/api/v1/assets", payload: body, headers });

    expect(response.statusCode).toBe(401);
    expect(dependencies.assetUploads.upload).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a JSON body with 415 rather than failing internally", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => authedSession);
    const app = createApp(dependencies);

    const response = await app.inject({ method: "POST", url: "/api/v1/assets", payload: { file: "nope" } });

    expect(response.statusCode).toBe(415);
    await app.close();
  });
});

describe("frontend crash reporting", () => {
  it("accepts a sanitized frontend crash and returns a tracking id", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      headers: { "user-agent": "DEEV E2E" },
      payload: {
        type: "frontend_crash",
        release: "2026.08.12",
        host: "web",
        route: "/generate/seedance",
        code: "provider_unavailable",
        requestId: "req-7",
        occurredAt: 123,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true, reportId: "report-1" });
    expect(dependencies.frontendTelemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/generate/seedance", code: "provider_unavailable" }),
    );
    await app.close();
  });

  it("rejects prompts, messages, stacks and query strings", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      payload: {
        type: "frontend_crash",
        release: "2026.08.12",
        host: "web",
        route: "/generate/seedance?prompt=private",
        code: "provider_unavailable",
        occurredAt: 123,
        message: "raw provider response",
        stack: "private stack",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.frontendTelemetry.record).not.toHaveBeenCalled();
    await app.close();
  });

  it("rate limits repeated crash submissions before they reach storage", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies, { telemetryRateLimit: { max: 1, windowMs: 60_000 } });
    const payload = {
      type: "frontend_crash",
      release: "2026.08.12",
      host: "web",
      route: "/studio/video",
      code: "network_error",
      occurredAt: 123,
    };

    expect((await app.inject({ method: "POST", url: "/api/v1/telemetry/errors", payload })).statusCode).toBe(202);
    const limited = await app.inject({ method: "POST", url: "/api/v1/telemetry/errors", payload });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(dependencies.frontendTelemetry.record).toHaveBeenCalledOnce();
    await app.close();
  });

  it("uses the shared rate limiter decision before storing a crash", async () => {
    const dependencies = healthyDependencies();
    const consume = vi.fn(async () => 37);
    const app = createApp(dependencies, { telemetryRateLimiter: { consume } });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      payload: {
        type: "frontend_crash",
        release: "2026.08.12",
        host: "web",
        route: "/studio/video",
        code: "network_error",
        occurredAt: 123,
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("37");
    expect(consume).toHaveBeenCalledWith("127.0.0.1");
    expect(dependencies.frontendTelemetry.record).not.toHaveBeenCalled();
    await app.close();
  });

  it("uses the forwarded client IP only when a trusted proxy is configured", async () => {
    const dependencies = healthyDependencies();
    const consume = vi.fn(async () => 10);
    const app = createApp(dependencies, { telemetryRateLimiter: { consume }, trustProxy: "127.0.0.1" });

    await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      headers: { "x-forwarded-for": "203.0.113.9" },
      payload: {},
    });

    expect(consume).toHaveBeenCalledWith("203.0.113.9");
    await app.close();
  });

  it("falls back to the local limit when the shared limiter is unavailable", async () => {
    const dependencies = healthyDependencies();
    const consume = vi.fn(async () => Promise.reject(new Error("redis offline")));
    const app = createApp(dependencies, {
      telemetryRateLimiter: { consume },
      telemetryRateLimit: { max: 1, windowMs: 60_000 },
    });
    const payload = {
      type: "frontend_crash",
      release: "2026.08.12",
      host: "web",
      route: "/studio/video",
      code: "network_error",
      occurredAt: 123,
    };

    expect((await app.inject({ method: "POST", url: "/api/v1/telemetry/errors", payload })).statusCode).toBe(202);
    const limited = await app.inject({ method: "POST", url: "/api/v1/telemetry/errors", payload });

    expect(limited.statusCode).toBe(429);
    expect(dependencies.frontendTelemetry.record).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects oversized reports with 413 instead of turning them into server errors", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      payload: {
        type: "frontend_crash",
        release: "x".repeat(9_000),
        host: "web",
        route: "/studio/video",
        code: "network_error",
        occurredAt: 123,
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    expect(dependencies.frontendTelemetry.record).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects timestamps outside the JavaScript Date range", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      payload: {
        type: "frontend_crash",
        release: "2026.08.12",
        host: "web",
        route: "/studio/video",
        code: "network_error",
        occurredAt: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.frontendTelemetry.record).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a client error for malformed JSON without logging it as a server crash", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/telemetry/errors",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(dependencies.frontendTelemetry.record).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("API health wiring", () => {
  it("enables structured logging when the production server requests it", async () => {
    const app = createApp(healthyDependencies(), { logger: true });

    expect(app.log.level).toBe("info");
    await app.close();
  });

  it("reports ready only when every dependency responds", async () => {
    const app = createApp(healthyDependencies());
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      dependencies: { database: "up", redis: "up", storage: "up" },
    });
    await app.close();
  });

  it("distinguishes dependency degradation from process liveness", async () => {
    const dependencies = healthyDependencies();
    dependencies.redis.ping = vi.fn(async () => Promise.reject(new Error("offline")));
    const app = createApp(dependencies);

    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    const readiness = await app.inject({ method: "GET", url: "/health/ready" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({ status: "degraded", dependencies: { redis: "down" } });
    await app.close();
  });
});

describe("customer session", () => {
  it("returns an anonymous web session when no principal resolves", async () => {
    const app = createApp(healthyDependencies());

    const response = await app.inject({ method: "GET", url: "/api/v1/session" });

    expect(response.statusCode).toBe(200);
    // No auth options at all, so no provider has routes and none is offered.
    expect(response.json()).toEqual({ status: "anonymous", host: "web", authProviders: [] });
    await app.close();
  });

  it("returns the internal Vgen user once a principal resolves", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => ({
      status: "authed" as const,
      host: "web" as const,
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        methods: ["email" as const],
        emailNormalized: "person@example.com",
        displayName: "Vgen User",
        locale: "fa" as const,
        isTeam: false,
      },
    }));
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/session", headers: { authorization: "Bearer session-token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "authed",
      host: "web",
      user: { id: "00000000-0000-4000-8000-000000000001", emailNormalized: "person@example.com" },
    });
    await app.close();
  });

  /**
   * The point of the whole field. A provider whose credentials are unset has
   * no endpoint, so a button for it navigates into a 404 after the person has
   * already decided to use it — and nothing the browser could read said which
   * ones were real.
   */
  it("offers only the providers whose routes were actually registered", async () => {
    const allow = () => ({ consume: vi.fn(async () => null) });
    const app = createApp(healthyDependencies(), {
      auth: {
        dependencies: {
          auth: {} as never,
          sms: { sendVerificationCode: vi.fn(async () => undefined) },
        },
        options: {
          cookie: { secure: true },
          limiters: {
            otpSendPerPhone: allow(),
            otpSendPerIp: allow(),
            otpVerifyPerPhone: allow(),
            loginPerAccount: allow(),
            loginPerIp: allow(),
          },
          webOrigin: "https://deev.test",
          // Google configured, Microsoft not — which is the asymmetry the
          // browser had no way to see.
          google: {
            createAuthorizationUrl: () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "state-abc" }),
            exchangeCode: vi.fn(async () => ({ subject: "g-1", email: null, emailVerified: false, displayName: null })),
          } as never,
        },
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/session" });

    expect(response.json().authProviders).toEqual(["google"]);
    // And the claim is true: the offered one answers, the unoffered one does not.
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/google" })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/microsoft" })).statusCode).toBe(404);
    await app.close();
  });
});

describe("customer catalog", () => {
  it("returns the latest catalog projection", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerCatalog.list = vi.fn(async () => ({
      version: "catalog-2",
      publishedAt: 1_786_406_400_000,
      families: [
        {
          id: "deev-test",
          name: "DEEV Test",
          vendor: "DEEV",
          kind: "image" as const,
          minTier: 1 as const,
          blurb: "Test family",
          grad: "linear-gradient(135deg,#111,#333)",
          controls: [],
          variants: [{ id: "deev-test-v1", model: "deev/test-v1", featureCode: "image_generate", label: "v1" }],
        },
      ],
    }));
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/catalog" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ version: "catalog-2", families: [{ id: "deev-test" }] });
    expect(dependencies.customerCatalog.list).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe("customer wallet", () => {
  it("returns the authenticated customer's wallet projection", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerSession.getCurrent = vi.fn(async () => ({
      status: "authed" as const,
      host: "web" as const,
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        methods: ["email" as const],
        emailNormalized: "person@example.com",
        locale: "fa" as const,
        isTeam: false,
      },
    }));
    dependencies.customerWallet.getCurrent = vi.fn(async () => ({
      spendable: 12,
      grants: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          kind: "signup_gift" as const,
          coinsGranted: 12,
          coinsRemaining: 12,
          grantedAt: 1_786_406_400_000,
          expiresAt: 1_787_616_000_000,
        },
      ],
      nextExpiry: { at: 1_787_616_000_000, coins: 12 },
    }));
    const app = createApp(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/v1/wallet", headers: { authorization: "Bearer session-token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ spendable: 12, grants: [{ kind: "signup_gift", coinsRemaining: 12 }] });
    expect(dependencies.customerWallet.getCurrent).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
    await app.close();
  });

  it("rejects an anonymous wallet request", async () => {
    const app = createApp(healthyDependencies());

    const response = await app.inject({ method: "GET", url: "/api/v1/wallet" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthorized" } });
    await app.close();
  });
});

describe("the plan ladder", () => {
  it("serves the plans a card is rendered from", async () => {
    const dependencies = healthyDependencies();
    dependencies.customerPlans.list = vi.fn(async () => [
      {
        code: "pro",
        name: "Pro",
        tier: 2 as const,
        coinsPerTerm: 1100,
        baseCoins: 1000,
        bonusCoins: 100,
        termDays: 30,
        monthlyUsd: 49,
        annualUsdPerMonth: 39,
        group: "main" as const,
        tag: "popular" as const,
        popular: true,
        maxConcurrentJobs: 4,
      },
    ]);
    const app = createApp(dependencies, { corsOrigin: "https://deev.test" });

    const response = await app.inject({ method: "GET", url: "/api/v1/plans" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ plans: [expect.objectContaining({ code: "pro", coinsPerTerm: 1100 })] });
    await app.close();
  });

  // Anonymous on purpose: someone deciding whether to sign up has to see what a
  // plan costs before they have an account to see it with.
  it("does not require a session", async () => {
    const dependencies = healthyDependencies();
    const app = createApp(dependencies, { corsOrigin: "https://deev.test" });

    const response = await app.inject({ method: "GET", url: "/api/v1/plans" });

    expect(response.statusCode).toBe(200);
    expect(dependencies.customerSession.getCurrent).not.toHaveBeenCalled();
    await app.close();
  });
});
