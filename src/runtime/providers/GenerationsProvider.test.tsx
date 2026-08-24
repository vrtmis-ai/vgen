import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "../AppServices";
import { CatalogProvider } from "../../features/catalog/CatalogProvider";
import { createDemoCatalogService } from "../../adapters/demo/catalog";
import { createDemoServices } from "../../adapters/demo/demoServices";
import type { AppServices } from "../AppServices";
import { defaultInput, variantControls, type Family } from "../../data/models";
import { loadGenerations, saveGenerations, type Generation } from "../../lib/gallery";
import { GenerationsProvider, useGenerations } from "./GenerationsProvider";
import { NavigationProvider } from "./NavigationProvider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/studio/video",
}));

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

function Uploader({ refs }: { refs: Record<string, { file: File; url: string }[]> }) {
  const { startGeneration } = useGenerations();
  return (
    <button
      onClick={() => {
        void startGeneration("nano-banana", "یک گربه", INPUT, VARIANT_WITH_REF, refs as never);
      }}
    >
      go
    </button>
  );
}

function renderWithServices(services: AppServices, refs: Record<string, { file: File; url: string }[]>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <AppServicesProvider services={services}>
        <CatalogProvider families={catalog.families}>
          <NavigationProvider>
            <GenerationsProvider>
              <Uploader refs={refs} />
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
