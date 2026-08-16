import { describe, expect, it, vi } from "vitest";
import { createHttpAuthService } from "./auth";
import { ApiError, createHttpClient } from "./client";

const AUTHED = {
  status: "authed",
  host: "web",
  user: { id: "u1", methods: ["email"], emailNormalized: "a@b.co", locale: "fa" },
};

const BASE_URL = "https://api.test/api/v1";

function harness(response: Response) {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { auth: createHttpAuthService(client, BASE_URL), fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function callOf(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return { url, init, body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined };
}

describe("http auth", () => {
  it("posts a phone number and reads back when the code expires", async () => {
    const { auth, fetchImpl } = harness(json({ sent: true, expiresAt: 123 }));
    await expect(auth.startPhoneVerification({ phone: "09123334444" })).resolves.toEqual({ sent: true, expiresAt: 123 });

    const { url, init, body } = callOf(fetchImpl);
    expect(url).toBe("https://api.test/api/v1/auth/otp/start");
    expect(init.method).toBe("POST");
    // The session is an HttpOnly cookie, so the request has to carry it.
    expect(init.credentials).toBe("include");
    expect(body).toEqual({ phone: "09123334444" });
  });

  it("sends the phone number as typed, because the server normalises it", async () => {
    const { auth, fetchImpl } = harness(json({ sent: true, expiresAt: 1 }));
    await auth.startPhoneVerification({ phone: "۰۹۱۲۳۳۳۴۴۴۴" });
    expect(callOf(fetchImpl).body).toEqual({ phone: "۰۹۱۲۳۳۳۴۴۴۴" });
  });

  it("omits optional fields rather than sending them undefined", async () => {
    // The server's schemas are .strict(); an unexpected key is a
    // validation_failed rather than an ignored field.
    const { auth, fetchImpl } = harness(json(AUTHED));
    await auth.register({ email: "a@b.co", password: "correct-horse-battery" });
    expect(callOf(fetchImpl).body).toEqual({ email: "a@b.co", password: "correct-horse-battery" });
  });

  it("passes an invite code through when there is one", async () => {
    const { auth, fetchImpl } = harness(json(AUTHED));
    await auth.register({ email: "a@b.co", password: "correct-horse-battery", inviteCode: "APPLE-DEEV" });
    expect(callOf(fetchImpl).body).toMatchObject({ inviteCode: "APPLE-DEEV" });
  });

  it("returns the new session, so no second round trip is needed", async () => {
    const { auth } = harness(json(AUTHED));
    await expect(auth.login({ email: "a@b.co", password: "correct-horse-battery" })).resolves.toMatchObject({ status: "authed" });
  });

  it("logs out without a body, which is what the 204 route accepts", async () => {
    const { auth, fetchImpl } = harness(new Response(null, { status: 204 }));
    await expect(auth.logout()).resolves.toBeUndefined();

    const { init } = callOf(fetchImpl);
    expect(init.body).toBeUndefined();
    // No body means no Content-Type, which matters: Fastify rejects an empty
    // body that declares itself JSON before the route runs.
    expect(new Headers(init.headers).get("content-type")).toBeNull();
  });

  it("surfaces the server's error code, not its prose", async () => {
    const { auth } = harness(json({ error: { code: "invite_required", message: "DEEV is in early access", request_id: "req-1" } }, 403));
    const error = await auth.register({ email: "a@b.co", password: "correct-horse-battery" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "invite_required", status: 403, requestId: "req-1" });
  });

  it("carries the retry delay on a rate limit", async () => {
    const { auth } = harness(
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "30" },
      }),
    );
    const error = await auth.startPhoneVerification({ phone: "09123334444" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "rate_limited", retryAfterMs: 30_000 });
  });
});
