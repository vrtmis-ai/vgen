import { describe, expect, it } from "vitest";
import type { ObjectStore, StoredObject } from "@vgen/adapters";
import { HttpOutputMirror } from "./outputMirror";

/**
 * The mirror is where a generated file gets measured, because it is the only
 * moment the whole thing is in memory. `measure` has its own tests against real
 * encoder output; what is worth pinning here is the wiring — delete the spread
 * in `mirror()` and every gallery item silently goes back to having no size,
 * with nothing else in the suite noticing.
 */

// A real 3x2 PNG, so the assertion is about bytes rather than about a stub.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR42mPkOhHFwMDAwMDAxAADABUEATBmaAjSAAAAAElFTkSuQmCC",
  "base64",
);

const store: ObjectStore = {
  bucket: "vgen",
  put: async (key, body, mimeType): Promise<StoredObject> => ({ bucket: "vgen", key, mimeType, byteSize: body.byteLength, sha256: "sha" }),
  signedUrl: async () => "",
  delete: async () => {},
  ensureBucket: async () => {},
};

describe("HttpOutputMirror", () => {
  const mirror = (bytes: Uint8Array, mimeType: string) =>
    new HttpOutputMirror({
      store,
      fetch: async () => new Response(bytes, { headers: { "content-type": mimeType } }),
    }).mirror({ url: "https://provider.example/out", kind: "image", mimeType }, { accountId: "a", jobId: "j", index: 0 });

  it("measures what it stored", async () => {
    expect(await mirror(PNG, "image/png")).toMatchObject({ width: 3, height: 2, durationMs: null });
  });

  /**
   * A generation the provider has already been paid for must not be lost over
   * an unreadable header, so an unmeasurable file mirrors with nulls — which is
   * what these columns held before any of this existed.
   */
  it("still stores a file it cannot measure", async () => {
    const stored = await mirror(new Uint8Array([1, 2, 3, 4]), "application/octet-stream");
    expect(stored).toMatchObject({ bucket: "vgen", byteSize: 4, width: null, height: null, durationMs: null });
  });
});
