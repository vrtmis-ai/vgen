import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpClient } from "./client";

const payloadSchema = z.object({ value: z.number() });

describe("HTTP client", () => {
  it("sends cookies and validates successful JSON", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ value: 42 }));
    const client = createHttpClient({ baseUrl: "https://api.example.test/v1", fetchImpl });

    await expect(client.request("/session", { schema: payloadSchema })).resolves.toEqual({ value: 42 });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.test/v1/session", expect.objectContaining({ credentials: "include" }));
  });

  it("requests a fresh Clerk token for every authenticated API call", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ value: 42 }));
    const getAccessToken = vi.fn().mockResolvedValueOnce("clerk-token-1").mockResolvedValueOnce("clerk-token-2");
    const client = createHttpClient({ baseUrl: "https://api.example.test/v1", fetchImpl, getAccessToken });

    await client.request("/session", { schema: payloadSchema });
    await client.request("/wallet", { schema: payloadSchema });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/v1/session",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer clerk-token-1" }) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/v1/wallet",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer clerk-token-2" }) }),
    );
  });

  it("maps malformed success responses", async () => {
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn(async () => Response.json({ value: "wrong" }, { headers: { "x-request-id": "req-1" } })),
    });

    await expect(client.request("/session", { schema: payloadSchema })).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
      requestId: "req-1",
    });
  });

  it.each([
    [401, "unauthorized"],
    [409, "idempotency_conflict"],
  ])("maps an HTTP %s error", async (status, code) => {
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      // snake_case, because that is the envelope the API actually sends. This
      // fixture used to say requestId, matching a schema that therefore never
      // matched a real response.
      fetchImpl: vi.fn(async () => Response.json({ error: { code, message: "Request rejected", request_id: "req-body" } }, { status })),
    });

    await expect(client.request("/jobs", { schema: payloadSchema })).rejects.toMatchObject({ code, status, requestId: "req-body" });
  });

  it("keeps retry metadata for rate limits", async () => {
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      fetchImpl: vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "3", "x-request-id": "req-429" } })),
    });

    await expect(client.request("/jobs", { schema: payloadSchema })).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      requestId: "req-429",
      retryAfterMs: 3000,
    });
  });

  it("distinguishes caller aborts from timeouts", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const client = createHttpClient({ baseUrl: "https://api.example.test", fetchImpl, timeoutMs: 5 });
    const controller = new AbortController();
    controller.abort();

    await expect(client.request("/session", { schema: payloadSchema, signal: controller.signal })).rejects.toEqual(
      expect.objectContaining({ code: "request_aborted" }),
    );
    await expect(client.request("/session", { schema: payloadSchema })).rejects.toEqual(
      expect.objectContaining({ code: "request_timeout" }),
    );
  });
});
