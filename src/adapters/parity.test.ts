import { describe, expect, it, vi } from "vitest";
import { createDemoServices } from "./demo/demoServices";
import { createHttpServices } from "./http/httpServices";
import { ApiError } from "../runtime/apiError";

/**
 * The two adapters have to be interchangeable, because that is the entire claim
 * demo mode makes: build a screen against it and the same screen works in
 * production.
 *
 * The failure this guards against already happened once. The demo auth adapter
 * threw its own error class that merely copied ApiError's fields, so a screen
 * doing `error instanceof ApiError` — the pattern the session gate uses — read
 * the code fine in production and got nothing in the mode it was built in.
 */

describe("adapter parity", () => {
  it("exposes the same service names in both modes", () => {
    const demo = createDemoServices();
    const http = createHttpServices("https://api.test/api/v1");
    expect(Object.keys(demo).sort()).toEqual(Object.keys(http).sort());
  });

  it("exposes the same auth methods in both modes", () => {
    const demo = createDemoServices();
    const http = createHttpServices("https://api.test/api/v1");
    expect(Object.keys(demo.auth).sort()).toEqual(Object.keys(http.auth).sort());
  });

  it("rejects with ApiError from demo mode, not a lookalike", async () => {
    // `instanceof` is the check a screen makes; a class that merely has .code
    // and .status would pass every other assertion here and still fail it.
    const { auth } = createDemoServices({ startAnonymous: true });
    const error = await auth.register({ email: "a@b.co", password: "correct-horse-battery" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "invite_required", status: 403 });
  });

  it("rejects with ApiError from the HTTP adapter too", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: "invite_required", message: "nope", request_id: "r1" } }, { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const { auth } = createHttpServices("https://api.test/api/v1");
    const error = await auth.register({ email: "a@b.co", password: "correct-horse-battery" }).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "invite_required", status: 403 });
  });
});
