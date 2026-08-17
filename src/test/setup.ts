import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

/**
 * jsdom implements `window.scrollTo` and nothing else — an element has no
 * `scrollTo` at all, so a carousel resetting its own scroll position throws
 * rather than doing nothing. The plans screen does exactly that when the
 * billing cycle changes, which took its whole suite down.
 */
Object.defineProperty(Element.prototype, "scrollTo", {
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
 * jsdom has no IntersectionObserver, and framer-motion's `whileInView` reaches
 * for one the moment a section mounts.
 *
 * It reports intersecting straight away rather than never: a section that is
 * permanently off-screen would sit at its `hidden` variant, so a test asserting
 * on a heading inside one would be reading an element the user could not see.
 * In a headless run everything is on screen.
 */
class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

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
