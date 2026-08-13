import { describe, expect, it } from "vitest";
import { resolveRuntime } from "./runtime";

describe("runtime service selection", () => {
  it("enables demo adapters only when demo mode is explicit", () => {
    expect(resolveRuntime({ VITE_APP_MODE: "demo" }).ready).toBe(true);
    expect(resolveRuntime({}).ready).toBe(false);
  });

  it("explains a missing production API configuration", () => {
    const runtime = resolveRuntime({ VITE_APP_MODE: "production" });
    expect(runtime.ready).toBe(false);
    if (!runtime.ready) expect(runtime.message).toContain("VITE_API_BASE_URL");
  });

  it("creates production HTTP services when the API is configured", () => {
    expect(resolveRuntime({ VITE_APP_MODE: "production", VITE_API_BASE_URL: "https://api.example.test" }).ready).toBe(true);
  });
});
