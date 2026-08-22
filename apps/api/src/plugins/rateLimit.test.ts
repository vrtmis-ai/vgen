import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { bucketFor, createMemoryRateLimiter, registerRateLimits, type RateLimiter } from "./rateLimit";

/** A limiter that always refuses, so a test can prove *which* bucket was spent. */
const refusing = (seconds = 30): RateLimiter => ({ consume: vi.fn(async () => seconds) });
const allowing = (): RateLimiter => ({ consume: vi.fn(async () => null) });

function appWith(read: RateLimiter, write: RateLimiter): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRateLimits(app, { buckets: { read, write } });
  app.get("/api/v1/catalog", async () => ({ ok: true }));
  app.post("/api/v1/generation/quotes", async () => ({ ok: true }));
  app.post("/api/v1/auth/otp", async () => ({ ok: true }));
  app.post("/api/v1/telemetry/errors", async () => ({ ok: true }));
  app.get("/api/v1/admin/session", async () => ({ ok: true }));
  app.get("/health/ready", async () => ({ ok: true }));
  return app;
}

describe("which requests are counted", () => {
  it("separates reads from writes, and exempts what is limited elsewhere", () => {
    expect(bucketFor("GET", "/api/v1/catalog")).toBe("read");
    expect(bucketFor("HEAD", "/api/v1/gallery?limit=20")).toBe("read");
    expect(bucketFor("POST", "/api/v1/generation/quotes")).toBe("write");
    expect(bucketFor("POST", "/api/v1/jobs")).toBe("write");
    expect(bucketFor("DELETE", "/api/v1/admin/sessions/1")).toBeNull();

    // Auth and telemetry already have ceilings of their own, tuned to what they
    // are protecting. A second one stacked on top would make the effective
    // limit whichever fired first, which is not a limit anybody chose.
    expect(bucketFor("POST", "/api/v1/auth/otp/request")).toBeNull();
    expect(bucketFor("POST", "/api/v1/telemetry/errors")).toBeNull();

    // A monitoring system that gets a 429 declares an outage.
    expect(bucketFor("GET", "/health/ready")).toBeNull();
    expect(bucketFor("GET", "/health/live")).toBeNull();
  });
});

describe("refusing too many requests", () => {
  it("answers 429 with the seconds to wait, and does not run the handler", async () => {
    const handler = vi.fn();
    const app = Fastify({ logger: false });
    registerRateLimits(app, { buckets: { read: refusing(42), write: allowing() } });
    app.get("/api/v1/catalog", async () => {
      handler();
      return { ok: true };
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/catalog" });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("42");
    expect(response.json().error.code).toBe("rate_limited");
    // The whole point of an onRequest hook: a refused request costs a Redis
    // round trip and nothing else — no session lookup, no body parse, no query.
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the two budgets apart, so a read storm cannot block a submission", async () => {
    const read = refusing();
    const write = allowing();
    const app = appWith(read, write);

    expect((await app.inject({ method: "GET", url: "/api/v1/catalog" })).statusCode).toBe(429);
    expect((await app.inject({ method: "POST", url: "/api/v1/generation/quotes" })).statusCode).toBe(200);
    expect(write.consume).toHaveBeenCalledTimes(1);
  });

  it("leaves sign-in, telemetry, admin and health alone", async () => {
    const read = refusing();
    const write = refusing();
    const app = appWith(read, write);

    for (const [method, url] of [
      ["POST", "/api/v1/auth/otp"],
      ["POST", "/api/v1/telemetry/errors"],
      ["GET", "/api/v1/admin/session"],
      ["GET", "/health/ready"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(200);
    }
    expect(read.consume).not.toHaveBeenCalled();
    expect(write.consume).not.toHaveBeenCalled();
  });
});

describe("who gets counted", () => {
  /**
   * The reason this is not keyed on IP alone, and it is specific to where this
   * product sells: Iranian mobile networks are heavily CGNAT'd, so thousands of
   * unrelated customers arrive from one public address. Keyed on IP, one busy
   * person would exhaust the budget for everyone else on their carrier — the
   * limit would fire, correctly by its own logic, on the wrong people.
   */
  it("gives two signed-in customers separate budgets from the same address", async () => {
    const read = allowing();
    const app = appWith(read, allowing());

    await app.inject({ method: "GET", url: "/api/v1/catalog", headers: { cookie: "deev_session=alice-token" } });
    await app.inject({ method: "GET", url: "/api/v1/catalog", headers: { cookie: "deev_session=bob-token" } });

    const subjects = vi.mocked(read.consume).mock.calls.map(([subject]) => subject);
    expect(subjects).toEqual(["read:s:alice-token", "read:s:bob-token"]);
    expect(new Set(subjects).size).toBe(2);
  });

  it("falls back to the address for a stranger, who has no identity to spend", async () => {
    const read = allowing();
    const app = appWith(read, allowing());

    await app.inject({ method: "GET", url: "/api/v1/catalog" });

    expect(vi.mocked(read.consume).mock.calls[0]?.[0]).toMatch(/^read:i:/);
  });
});

describe("when Redis is not there", () => {
  it("lets the request through rather than taking the shop down with it", async () => {
    const read: RateLimiter = { consume: vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))) };
    const app = appWith(read, allowing());

    // Deliberate: a Redis outage is an incident on its own, and turning it into
    // a total outage of a shop that was unlimited last week would be a worse
    // one. The abuse this guards against is slow, so an open window costs
    // rows, not correctness.
    expect((await app.inject({ method: "GET", url: "/api/v1/catalog" })).statusCode).toBe(200);
  });
});

describe("the in-process fallback", () => {
  it("counts a window, refuses past it, and starts again after it passes", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(3, 60_000, () => now);

    expect(await limiter.consume("a")).toBeNull();
    expect(await limiter.consume("a")).toBeNull();
    expect(await limiter.consume("a")).toBeNull();
    expect(await limiter.consume("a")).toBe(60);

    // A different subject is untouched by the first one's window.
    expect(await limiter.consume("b")).toBeNull();

    now += 30_000;
    expect(await limiter.consume("a")).toBe(30);

    now += 30_001;
    expect(await limiter.consume("a")).toBeNull();
  });
});
