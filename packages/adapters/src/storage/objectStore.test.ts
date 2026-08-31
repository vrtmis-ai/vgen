import { describe, expect, it } from "vitest";
import { createS3ObjectStore } from "./objectStore";

const CONFIG = {
  bucket: "vgen",
  region: "us-east-1",
  credentials: { accessKeyId: "vgen-local", secretAccessKey: "vgen-local-secret" },
};

const INTERNAL = "http://minio:9000";
const PUBLIC = "https://files.example.test";

function signatureOf(url: string): string {
  return new URL(url).searchParams.get("X-Amz-Signature") ?? "";
}

/**
 * The one thing about this store that a deployment can get wrong silently.
 *
 * A signed URL is read by two callers that are not on our network — the
 * browser, for every gallery item, and the generation provider, which fetches
 * each reference image from its own servers. So the host in that URL has to be
 * the public one even though the connection that writes the file should not be.
 */
describe("signing endpoint", () => {
  it("signs with the public name while connecting to the private one", async () => {
    const store = createS3ObjectStore({ ...CONFIG, endpoint: INTERNAL, publicEndpoint: PUBLIC });

    const url = await store.signedUrl("outputs/a.png");

    expect(url.startsWith(`${PUBLIC}/vgen/outputs/a.png`)).toBe(true);
    expect(url).not.toContain("minio:9000");
  });

  it("signs with its own endpoint when the store has only one name", async () => {
    const store = createS3ObjectStore({ ...CONFIG, endpoint: INTERNAL });

    expect((await store.signedUrl("outputs/a.png")).startsWith(`${INTERNAL}/vgen/outputs/a.png`)).toBe(true);
  });

  /**
   * Why this needed a second client rather than a string replace on the way
   * out: Host is one of the headers the signature covers, so a URL signed for
   * `minio:9000` and then rewritten to the public host is a URL the store
   * refuses. The two signatures differing is what that looks like from here.
   */
  it("puts the host inside the signature, so it cannot be swapped afterwards", async () => {
    const internal = createS3ObjectStore({ ...CONFIG, endpoint: INTERNAL });
    const published = createS3ObjectStore({ ...CONFIG, endpoint: INTERNAL, publicEndpoint: PUBLIC });

    const [a, b] = await Promise.all([internal.signedUrl("outputs/a.png"), published.signedUrl("outputs/a.png")]);

    expect(signatureOf(a)).not.toBe("");
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });
});
