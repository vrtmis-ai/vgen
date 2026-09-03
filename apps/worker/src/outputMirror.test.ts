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
      resolve: async () => ["93.184.216.34"],
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

  /**
   * The result address is the one URL this process fetches without having built
   * it, and it arrives from the provider. The worker sits on the compose
   * network beside Postgres, Redis and MinIO, so "fetch whatever you are told"
   * would make a compromised or mistaken provider a reader of services that
   * publish no port at all.
   */
  describe("refusing to fetch inside our own network", () => {
    // fetch throws, so any case that reaches it fails loudly rather than passing
    // for the wrong reason.
    const attempt = (url: string, addresses: string[] = []) =>
      new HttpOutputMirror({
        store,
        attempts: 1,
        fetch: () => {
          throw new Error("fetch was reached — the address should have been refused first");
        },
        resolve: async () => addresses,
      }).mirror({ url, kind: "image", mimeType: "image/png" }, { accountId: "a", jobId: "j", index: 0 });

    it.each([
      ["loopback by name", "http://localhost/x", ["127.0.0.1"]],
      ["a compose service name", "http://minio:9000/vgen/x", ["172.28.0.5"]],
      ["the cloud metadata service", "http://169.254.169.254/latest/meta-data/", []],
      ["an RFC1918 literal", "http://192.168.1.10/x", []],
      ["carrier-grade NAT", "http://100.64.0.1/x", []],
      ["IPv6 loopback", "http://[::1]/x", []],
      ["an IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/x", []],
      ["a public name that also answers privately", "https://provider.example/x", ["93.184.216.34", "10.0.0.7"]],
    ])("refuses %s", async (_label, url, addresses) => {
      await expect(attempt(url, addresses)).rejects.toThrow(/inside our own network/);
    });

    it("refuses a scheme that is not the web", async () => {
      await expect(attempt("file:///etc/passwd")).rejects.toThrow(/not fetched/);
    });

    it("refuses a name that resolves to nothing", async () => {
      await expect(attempt("https://nowhere.example/x", [])).rejects.toThrow(/does not resolve/);
    });

    it("allows an ordinary public address", async () => {
      // Reaching fetch is the pass condition here.
      await expect(attempt("https://cdn.example/out.png", ["93.184.216.34"])).rejects.toThrow(/fetch was reached/);
    });
  });
});
