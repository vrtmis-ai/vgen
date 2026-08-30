import { describe, expect, it, vi } from "vitest";
import { createHttpGenerationService } from "./generation";
import { createHttpClient } from "./client";

const BASE_URL = "https://api.test/api/v1";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const QUOTE = {
  id: "33333333-3333-4333-8333-333333333333",
  coins: 4,
  expiresAt: 1_755_353_400_000,
  concurrency: { running: 0, limit: 4 },
};

function harness() {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(QUOTE), { status: 200, headers: { "content-type": "application/json" } }));
  const client = createHttpClient({ baseUrl: BASE_URL, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { generation: createHttpGenerationService(client), fetchImpl };
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const request = {
  familyId: "nano-banana",
  variantId: "nano-banana-pro",
  prompt: "a small red boat",
  input: { resolution: "1K" },
  referenceAssetIds: {},
};

/**
 * This adapter is where two fields have gone to die.
 *
 * It narrows the studio's language — a family, a variant, control values,
 * reference slots — down to what the API accepts, and anything it forgets to
 * name is dropped in silence. `referenceAssetIds` was built by the provider,
 * handed to the mutation, and never put in the body for two PRs, with every
 * layer either side of the gap tested and green. The only way to see that is to
 * assert on what actually went over the wire.
 */
describe("http generation adapter", () => {
  it("sends the reference slot map", async () => {
    const { generation, fetchImpl } = harness();

    await generation.quote({ ...request, referenceAssetIds: { image_urls: [ASSET] } });

    expect(bodyOf(fetchImpl).referenceAssetIds).toEqual({ image_urls: [ASSET] });
  });

  it("sends an empty map when nothing was attached, rather than nothing at all", async () => {
    const { generation, fetchImpl } = harness();

    await generation.quote(request);

    // The server schema defaults it either way, so this is about a reader
    // rather than a parser: an absent key and an empty object mean subtly
    // different things and only one of them is what the screen intended.
    expect(bodyOf(fetchImpl).referenceAssetIds).toEqual({});
  });

  /**
   * The narrowing is the point of this file, so it is worth pinning what does
   * *not* go out: a request able to name its own feature, model or price is a
   * request able to ask to be billed as something cheaper than it is.
   */
  it("still sends nothing the API did not ask for", async () => {
    const { generation, fetchImpl } = harness();

    await generation.quote(request);

    expect(Object.keys(bodyOf(fetchImpl)).sort()).toEqual(["params", "prompt", "referenceAssetIds", "variantId"]);
  });

  it("sends the free-pipe preference only when the caller has one", async () => {
    const withOpinion = harness();
    await withOpinion.generation.quote({ ...request, preferUnlimited: false });
    expect(bodyOf(withOpinion.fetchImpl).preferUnlimited).toBe(false);

    const without = harness();
    await without.generation.quote(request);
    // Absent, not `false`: the server reads a missing field as "the grant
    // applies if you hold it", so filling one in here would start charging
    // people who were promised otherwise.
    expect(bodyOf(without.fetchImpl)).not.toHaveProperty("preferUnlimited");
  });
});
