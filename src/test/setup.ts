import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

/**
 * jsdom has no canvas, and says so loudly — once per render of anything that
 * asks for a 2D context. `DotField` already treats a missing context as "do not
 * draw", which is the correct behaviour in a headless run, so the only thing the
 * real implementation contributes is seven identical stack traces per suite.
 * Returning null hits the same branch quietly.
 */
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

vi.stubGlobal(
  "fetch",
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            records: [{ modelDescription: "test model", creditPrice: 1, creditUnit: "task" }],
            total: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ),
);
