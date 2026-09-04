import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "../AppServices";
import { CatalogProvider } from "../../features/catalog/CatalogProvider";
import { createDemoCatalogService } from "../../adapters/demo/catalog";
import { createDemoServices } from "../../adapters/demo/demoServices";
import type { AppServices } from "../AppServices";
import { defaultInput, variantControls, type Family } from "../../data/models";
import { loadGenerations, saveGenerations, type Generation } from "../../lib/gallery";
import { GenerationsProvider, useGenerations } from "./GenerationsProvider";
import { NavigationProvider } from "./NavigationProvider";

/* One stable push across the whole file rather than a fresh spy per
   `useRouter()` call. Where the provider sends the browser after a submit is
   behaviour worth asserting, and a mock that forgets is a mock that cannot. */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/studio/video",
}));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
});

const stored: Generation = {
  id: "gen-1",
  familyId: "seedance",
  variantId: "v1",
  name: "Seedance",
  vendor: "ByteDance",
  grad: "grad",
  kind: "video",
  prompt: "یک گربه",
  w: 1280,
  h: 720,
  status: "done",
  createdAt: 1_000,
};

function Probe() {
  const { gens } = useGenerations();
  return <output data-testid="count">{gens.length}</output>;
}

function renderProvider() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppServicesProvider services={createDemoServices()}>
        <CatalogProvider families={[]}>
          <NavigationProvider>
            <GenerationsProvider>
              <Probe />
            </GenerationsProvider>
          </NavigationProvider>
        </CatalogProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
}

/**
 * The generations list moved off a `useState(loadGenerations)` initialiser,
 * which read localStorage during render — fine in a browser-only SPA, a
 * hydration mismatch under SSR. The replacement starts empty and loads on
 * mount, which introduces a window where an unguarded save effect would write
 * that empty list straight over the user's real history.
 */
describe("generations persistence across the hydration gap", () => {
  it("loads what was stored instead of starting empty", async () => {
    saveGenerations([stored]);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  });

  it("never writes the pre-hydration empty list over stored generations", async () => {
    saveGenerations([stored]);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    expect(loadGenerations()).toHaveLength(1);
    expect(loadGenerations()[0]?.id).toBe("gen-1");
  });
});

/**
 * A real catalogue entry, not a fabricated one. The demo quote looks the
 * variant up and throws "Demo catalog does not contain the requested model
 * variant" for anything it does not have — which is the right behaviour and is
 * what caught the first version of this test.
 */
const catalog = await createDemoCatalogService(() => 0).list();
const FAMILY_WITH_REF = catalog.families.find((f) => f.id === "nano-banana")! as unknown as Family;
const VARIANT_WITH_REF = FAMILY_WITH_REF.variants.find((v) => v.id === "nano-banana-pro")!;
/** The slot that variant actually declares. */
const REF_SLOT = "image_input";
/** Real controls, real defaults — an empty input map fails validation. */
const INPUT = defaultInput(variantControls(FAMILY_WITH_REF, VARIANT_WITH_REF));

function Uploader({ refs, preferUnlimited }: { refs: Record<string, { file: File; url: string }[]>; preferUnlimited?: boolean }) {
  const { startGeneration } = useGenerations();
  return (
    <button
      onClick={() => {
        void startGeneration("nano-banana", "یک گربه", INPUT, VARIANT_WITH_REF, {
          refs,
          ...(preferUnlimited === undefined ? {} : { preferUnlimited }),
        });
      }}
    >
      go
    </button>
  );
}

function renderWithServices(services: AppServices, refs: Record<string, { file: File; url: string }[]>, preferUnlimited?: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <AppServicesProvider services={services}>
        <CatalogProvider families={catalog.families}>
          <NavigationProvider>
            <GenerationsProvider>
              <Uploader refs={refs} {...(preferUnlimited === undefined ? {} : { preferUnlimited })} />
            </GenerationsProvider>
          </NavigationProvider>
        </CatalogProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
}

/**
 * The provider used to refuse outright any generation carrying a reference,
 * because Files are not serialisable and dropping them silently would have
 * quoted a first-frame model with no first frame. Uploading them first is what
 * removes that guard.
 */
describe("reference images reach the quote", () => {
  const file = () => new File(["x"], "ref.png", { type: "image/png" });

  it("uploads each picked file and sends its id under the slot that held it", async () => {
    const services = createDemoServices();
    const upload = vi.fn(services.assets.upload);
    const quote = vi.fn(services.generation.quote);
    const create = vi.fn(services.generation.create);
    const spied: AppServices = { ...services, assets: { upload }, generation: { ...services.generation, quote, create } };

    renderWithServices(spied, {
      [REF_SLOT]: [
        { file: file(), url: "blob:a" },
        { file: file(), url: "blob:b" },
      ],
    });
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    const sent = quote.mock.calls[0]?.[0] as { referenceAssetIds: Record<string, string[]> } | undefined;
    expect(sent?.referenceAssetIds[REF_SLOT]).toHaveLength(2);
  });

  it("sends an empty map when nothing was picked, rather than an absent field", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const spied: AppServices = { ...services, generation: { ...services.generation, quote } };

    renderWithServices(spied, {});
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as { referenceAssetIds: Record<string, string[]> } | undefined;
    expect(sent?.referenceAssetIds).toEqual({});
  });
});

/**
 * The dock's free-pipe switch has to survive the trip to the wire.
 *
 * The reason this is worth a test rather than a glance is that the same journey
 * has already silently failed once: `referenceAssetIds` was built here, handed
 * to the mutation, and dropped by the HTTP adapter, with every layer either
 * side of the gap tested and green. Asserting on what `services.generation.quote`
 * actually receives is the only place that gap is visible from.
 */
describe("the free-pipe preference reaches the quote", () => {
  it("sends nothing when the caller has no opinion, leaving the server its default", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const spied: AppServices = { ...services, generation: { ...services.generation, quote } };

    renderWithServices(spied, {});
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    // Absent, not `false`. The server reads a missing field as "the grant
    // applies if you hold it", so a helpfully-filled-in false here would start
    // charging people the switch was never shown to.
    expect(sent).not.toHaveProperty("preferUnlimited");
  });

  it("carries a decline through to the request", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const spied: AppServices = { ...services, generation: { ...services.generation, quote } };

    renderWithServices(spied, {}, false);
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as { preferUnlimited?: boolean } | undefined;
    expect(sent?.preferUnlimited).toBe(false);
  });

  it("carries an explicit request for the free pipe too", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const spied: AppServices = { ...services, generation: { ...services.generation, quote } };

    renderWithServices(spied, {}, true);
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as { preferUnlimited?: boolean } | undefined;
    expect(sent?.preferUnlimited).toBe(true);
  });
});

/**
 * Pressing create in a studio and watching the page not move.
 *
 * The three studios all submit through `requestGeneration`, which was
 * fire-and-forget in the strictest sense: the job went, the coins were held,
 * and nothing on screen acknowledged the press. The new generation did appear
 * as a tile in the canvas, but on the video studio that canvas is beside a
 * 320px form panel and below the fold — so the button read as dead, and was
 * reported as dead.
 *
 * Asserted on the router rather than on a rendered result, because the bug was
 * never about what the destination looks like. It was that there wasn't one.
 */
describe("submitting from a studio takes you to your work", () => {
  function Dock() {
    const { requestGeneration } = useGenerations();
    return <button onClick={() => requestGeneration("nano-banana", "یک گربه", INPUT, VARIANT_WITH_REF)}>dock</button>;
  }

  function renderDock(services: AppServices) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <AppServicesProvider services={services}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <GenerationsProvider>
                <Dock />
              </GenerationsProvider>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
  }

  it("navigates to کارهای من once the job is accepted", async () => {
    renderDock(createDemoServices());

    await act(async () => screen.getByText("dock").click());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/gallery"));
  });

  it("stays put when the submit is refused, so the error is still on screen", async () => {
    const services = createDemoServices();
    // A refusal, not a throw: `startGeneration` returns null for a variant the
    // catalogue does not hold, which is the same "nothing was created" outcome
    // as a rejected quote and must not move the page either.
    const spied: AppServices = {
      ...services,
      generation: { ...services.generation, quote: vi.fn().mockRejectedValue(new Error("nope")) },
    };
    renderDock(spied);

    await act(async () => screen.getByText("dock").click());

    await waitFor(() => expect(router.push).not.toHaveBeenCalled());
  });
});

/**
 * "To video": a finished image handed to a video model as its opening frame.
 *
 * The file is already in our store under an asset id, so there is nothing to
 * upload — and the quote endpoint accepts ids, not bytes. What this guards is
 * the merge: a slot can hold a carried-in asset *and* a picked file, and an
 * earlier version of this overwrote one map with the other.
 */
describe("already-stored assets reach the quote alongside uploads", () => {
  function Carrier({ assetRefs, refs }: { assetRefs: Record<string, string[]>; refs: Record<string, { file: File; url: string }[]> }) {
    const { startGeneration } = useGenerations();
    return <button onClick={() => void startGeneration("nano-banana", "یک گربه", INPUT, VARIANT_WITH_REF, { refs, assetRefs })}>go</button>;
  }

  function renderCarrier(services: AppServices, assetRefs: Record<string, string[]>, refs: Record<string, { file: File; url: string }[]>) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <AppServicesProvider services={services}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <GenerationsProvider>
                <Carrier assetRefs={assetRefs} refs={refs} />
              </GenerationsProvider>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
  }

  it("sends a carried asset id under its slot with nothing uploaded", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const upload = vi.fn(services.assets.upload);
    const spied: AppServices = { ...services, assets: { upload }, generation: { ...services.generation, quote } };

    renderCarrier(spied, { [REF_SLOT]: ["asset-from-gallery"] }, {});
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as { referenceAssetIds: Record<string, string[]> } | undefined;
    expect(sent?.referenceAssetIds[REF_SLOT]).toEqual(["asset-from-gallery"]);
    // Nothing to upload: the bytes are already ours.
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps both when the same slot also holds a picked file, carried one first", async () => {
    const services = createDemoServices();
    const quote = vi.fn(services.generation.quote);
    const spied: AppServices = { ...services, generation: { ...services.generation, quote } };

    renderCarrier(
      spied,
      { [REF_SLOT]: ["asset-from-gallery"] },
      {
        [REF_SLOT]: [{ file: new File(["x"], "ref.png", { type: "image/png" }), url: "blob:a" }],
      },
    );
    await act(async () => screen.getByText("go").click());

    await waitFor(() => expect(quote).toHaveBeenCalled());
    const sent = quote.mock.calls[0]?.[0] as { referenceAssetIds: Record<string, string[]> } | undefined;
    expect(sent?.referenceAssetIds[REF_SLOT]).toHaveLength(2);
    expect(sent?.referenceAssetIds[REF_SLOT]?.[0]).toBe("asset-from-gallery");
  });
});
