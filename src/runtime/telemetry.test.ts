import { describe, expect, it } from "vitest";
import { ApiError } from "../adapters/http/client";
import { createCrashReport } from "./telemetry";

describe("crash telemetry", () => {
  it("keeps operational context without leaking messages or query parameters", () => {
    const report = createCrashReport(
      new ApiError({ code: "provider_unavailable", message: "secret prompt and provider payload", status: 503, requestId: "req-7" }),
      { release: "2026.08.11", route: "/generate/seedance?prompt=private", occurredAt: 123 },
    );

    expect(report).toMatchObject({
      type: "frontend_crash",
      release: "2026.08.11",
      route: "/generate/seedance",
      code: "provider_unavailable",
      requestId: "req-7",
      occurredAt: 123,
    });
    expect(JSON.stringify(report)).not.toContain("secret prompt");
    expect(JSON.stringify(report)).not.toContain("private");
  });
});
