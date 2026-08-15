import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "../AppServices";
import { CatalogProvider } from "../../features/catalog/CatalogProvider";
import { createDemoServices } from "../../adapters/demo/demoServices";
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
