import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppServicesProvider } from "../AppServices";
import { CatalogProvider } from "../../features/catalog/CatalogProvider";
import { createDemoCatalogService } from "../../adapters/demo/catalog";
import { createDemoServices } from "../../adapters/demo/demoServices";
import { ApiError } from "../../adapters/http/client";
import type { AppServices } from "../AppServices";
import { defaultInput, variantControls, type Family } from "../../data/models";
import { loadGenerations, saveGenerations, type Generation } from "../../lib/gallery";
import { GenerationsProvider, useGenerations } from "./GenerationsProvider";
import { NavigationProvider } from "./NavigationProvider";
import { SessionProvider } from "./SessionProvider";
import type { AccountUser } from "../contracts/session";
import type { Wallet } from "../contracts/wallet";
import { SubmitRefusalNote } from "../../components/GenerationVeils";

/* One stable push across the whole file rather than a fresh spy per
   `useRouter()` call. Where the provider sends the browser after a submit is
   behaviour worth asserting, and a mock that forgets is a mock that cannot. */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

/**
 * Signed in, because everything below is about an account's own generations.
 *
 * The provider reads the session now — it gates the history fetch on having an
 * account rather than on having read localStorage, which is what stopped every
 * anonymous page load from asking `GET /gallery` and collecting a 401. These
 * stacks had no SessionProvider at all, so the hook they now call would throw;
 * a signed-in one keeps every assertion here exactly as it was.
 */
const SIGNED_IN = {
  user: { id: "u-1", email: "harness@example.test" } as unknown as AccountUser,
  wallet: { coins: 12 } as unknown as Wallet,
  signIn: () => {},
  signUp: () => {},
  signOut: () => {},
};

/** The provider under test, with the session the real tree always has above it. */
function Generations({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider value={SIGNED_IN}>
      <GenerationsProvider>{children}</GenerationsProvider>
    </SessionProvider>
  );
}

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
            <Generations>
              <Probe />
            </Generations>
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
    saveGenerations([stored], "u-1");

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  });

  it("never writes the pre-hydration empty list over stored generations", async () => {
    saveGenerations([stored], "u-1");

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    expect(loadGenerations("u-1")).toHaveLength(1);
    expect(loadGenerations("u-1")[0]?.id).toBe("gen-1");
  });

  /* The leak. One key served the whole browser, so the second account to sign
     in on a machine opened on the first one's gallery — cards it had never
     made, whose job ids the server answers 404 for because they are not its
     jobs. Reported from a fresh account that arrived showing two finished
     Seedance generations. */
  it("does not hand one account the gallery of the account before it", async () => {
    saveGenerations([stored], "u-1");

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={createDemoServices()}>
          <CatalogProvider families={[]}>
            <NavigationProvider>
              <SessionProvider value={{ ...SIGNED_IN, user: { ...SIGNED_IN.user, id: "u-2" } }}>
                <GenerationsProvider>
                  <Probe />
                </GenerationsProvider>
              </SessionProvider>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    // And the first account still has its own work.
    expect(loadGenerations("u-1")).toHaveLength(1);
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
            <Generations>
              <Uploader refs={refs} {...(preferUnlimited === undefined ? {} : { preferUnlimited })} />
            </Generations>
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
 * Pressing create in a studio, and staying in the studio.
 *
 * The three studios all submit through `requestGeneration`. For a while it
 * sent the browser to کارهای من once a job was accepted, so that the press
 * visibly did something. That took people out of the form they were sending
 * several generations from, and it was reported as wrong: the answer belongs
 * on the studio's own canvas, which draws from `gens`.
 *
 * So both halves are asserted — the router is left alone, and the job is in
 * the list the canvas reads.
 */
describe("submitting from a studio keeps you in the studio", () => {
  const errorAction = vi.fn();

  /* The dock as the three studios build it: the provider's refusal handed
     straight to the notice that draws it. Rendered rather than stringified,
     because half of what was added is the button — and a refusal whose code
     does not survive the trip is a notice with nothing to press. */
  function Dock() {
    const { requestGeneration, submitError } = useGenerations();
    return (
      <>
        <button onClick={() => requestGeneration("nano-banana", "یک گربه", INPUT, VARIANT_WITH_REF)}>dock</button>
        <div data-testid="submit-error">{submitError ? <SubmitRefusalNote refusal={submitError} onAction={errorAction} /> : ""}</div>
      </>
    );
  }

  function renderDock(services: AppServices) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <AppServicesProvider services={services}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <Generations>
                <Dock />
              </Generations>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
  }

  it("leaves the page where it is once the job is accepted, with the job in the list", async () => {
    const services = createDemoServices();
    const create = vi.fn(services.generation.create);
    renderDock({ ...services, generation: { ...services.generation, create } });

    await act(async () => screen.getByText("dock").click());

    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const job = await create.mock.results[0]!.value;
    // Stored as it lands — the save effect runs off the same list the canvas draws.
    await waitFor(() => expect(loadGenerations("u-1").some((generation) => generation.jobId === job.id)).toBe(true));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  /* A refusal is answered in the dock. It used to raise a full-page 503 that
     said "درخواست ساخت کامل نشد" over every one of these codes — true of a
     short wallet, a full account and a dropped connection alike, and useless to
     all three. The message is the one the code names. */
  it("hands the dock the reason when the submit is refused, and stays put", async () => {
    const services = createDemoServices();
    const spied: AppServices = {
      ...services,
      generation: {
        ...services.generation,
        quote: vi.fn().mockRejectedValue(new ApiError({ code: "insufficient_credits", message: "no", status: 402 })),
      },
    };
    renderDock(spied);

    await act(async () => screen.getByText("dock").click());

    await waitFor(() => expect(screen.getByTestId("submit-error")).toHaveTextContent("اعتبار کیف پول"));
    expect(router.push).not.toHaveBeenCalled();

    // And the way out of it, which only the code can choose.
    screen.getByText("شارژ کیف پول").click();
    expect(errorAction).toHaveBeenCalledWith("wallet");
  });

  /* Most refusals have no destination — waiting is the fix — and the notice
     must not invent one. */
  it("offers no button for a refusal that has nowhere to send anyone", async () => {
    const services = createDemoServices();
    renderDock({
      ...services,
      generation: {
        ...services.generation,
        quote: vi.fn().mockRejectedValue(new ApiError({ code: "rate_limited", message: "no", status: 429 })),
      },
    });

    await act(async () => screen.getByText("dock").click());

    await waitFor(() => expect(screen.getByTestId("submit-error")).toHaveTextContent("تعداد درخواست‌ها زیاد"));
    expect(screen.queryByRole("button", { name: /کیف پول|پلن/ })).toBeNull();
  });

  it("says nothing about a refusal nobody has made yet", () => {
    renderDock(createDemoServices());

    expect(screen.getByTestId("submit-error")).toHaveTextContent("");
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
              <Generations>
                <Carrier assetRefs={assetRefs} refs={refs} />
              </Generations>
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

/**
 * The provider collapsed every server state onto two words:
 * `job.status === "succeeded" ? "done" : "running"`. A job the provider refused
 * settles in seconds and then renders as forever-generating, because nothing
 * ever revises the word — the poll stops the moment the server calls the job
 * settled, so the spinner outlives the job for as long as the tab is open.
 *
 * These read a real reconciliation: a stored generation, a server job, and what
 * the list says afterwards.
 */
describe("a settled job stops looking like a running one", () => {
  const running: Generation = { ...stored, id: "gen-2", jobId: "job-2", status: "running" };

  function StatusProbe() {
    const { gens } = useGenerations();
    const gen = gens.find((g) => g.id === "gen-2");
    return (
      <output data-testid="state">{`${gen?.status ?? "?"}|${gen?.error?.code ?? "-"}|${gen?.outW ?? "-"}x${gen?.outH ?? "-"}`}</output>
    );
  }

  function renderAgainst(job: object) {
    const services = createDemoServices();
    const spied: AppServices = {
      ...services,
      generation: { ...services.generation, getJob: vi.fn(async () => job as never) },
    };
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={spied}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <Generations>
                <StatusProbe />
              </Generations>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
  }

  const job = (over: Record<string, unknown>) => ({
    id: "job-2",
    familyId: "seedance",
    variantId: "v1",
    coins: 4.2,
    prompt: "یک گربه",
    createdAt: 1_000,
    updatedAt: 2_000,
    outputs: [],
    urlsExpireAt: null,
    ...over,
  });

  beforeEach(() => saveGenerations([running], "u-1"));

  it("says failed, and says why, when the provider refused it", async () => {
    renderAgainst(job({ status: "failed", error: { code: "provider_failed", message: "no" } }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("failed|provider_failed"));
  });

  it("treats an expired job as over rather than as still running", async () => {
    renderAgainst(job({ status: "expired" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("failed|-"));
  });

  /* Cancelled is over too, and it used to be told in the failure's words. It
     is the one ending the customer asked for, so it keeps its own status and
     the screens say «لغو شد» rather than «انجام نشد». */
  it("keeps a cancelled job apart from a refused one", async () => {
    renderAgainst(job({ status: "cancelled" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("cancelled|-"));
  });

  it("says a job the worker has not taken yet is queued, not running", async () => {
    renderAgainst(job({ status: "queued" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("queued|-"));
  });

  it("keeps saying running while the job really is", async () => {
    renderAgainst(job({ status: "running" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("running|-"));
  });

  /* The other half of the same discard: the reconciliation read `assetId` and
     `url` off the output and left `width`/`height` on the floor, so the card
     kept the aspect that was *asked* for. A 9:16 request answered at 768×1344
     is a 2% disagreement, and 2% of a tall card is the thin blue line along the
     top and bottom edges — the card's own gradient, showing through a
     `contain` fit. */
  it("records the size the file actually came back at", async () => {
    renderAgainst(
      job({
        status: "succeeded",
        outputs: [
          {
            assetId: "11111111-1111-4111-8111-111111111111",
            url: "https://files.example/x",
            kind: "image",
            mimeType: "image/png",
            width: 768,
            height: 1344,
            durationMs: null,
          },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("done|-|768x1344"));
  });

  /* The runaway. `refetchInterval` decided from `query.state.data?.status`, and
     an errored read has no data — the same shape as a read that has not landed
     yet — so it answered "still queued, ask again in a second" and never
     stopped. This list survives reloads and is not scoped to an account, so a
     browser holding ids the server answers 404 for sent one request per second
     per id for as long as the tab stayed open: a real session logged 6,573
     requests across 16 dead ids, 419 apiece, with the error banner up
     throughout. */
  it("stops asking about a job the server will not answer for", async () => {
    const services = createDemoServices();
    const getJob = vi.fn(async () => {
      throw new ApiError({ code: "job_not_found", message: "No such job.", status: 404 });
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={{ ...services, generation: { ...services.generation, getJob } } as AppServices}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <Generations>
                <StatusProbe />
              </Generations>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );

    // The hook's own `retry: 2`, so three attempts in total — one and two
    // backed-off retries. Those are wanted: they are what rides out a blip.
    await waitFor(() => expect(getJob).toHaveBeenCalledTimes(3), { timeout: 10_000 });

    // What must not happen is a fourth. Three more turns of the one-second
    // interval; before the guard each one was another request, forever.
    await new Promise((resolve) => setTimeout(resolve, 3_200));

    expect(getJob).toHaveBeenCalledTimes(3);
    // Longer than the default: two backed-off retries are three seconds before
    // the window this test actually watches even opens.
  }, 20_000);
});

/**
 * Calling a generation off before it starts.
 *
 * Only `queued` can be: once a worker has claimed the job the provider is
 * running it and the coins are being spent, which is why the route answers 409
 * `job_started` rather than pretending. The press can lose that race — the
 * worker may take it while the pointer is travelling — so the three answers are
 * three different things on screen, and none of them is optimistic.
 *
 * The capability itself is optional. A deployment whose API has no cancel route
 * hands back no `cancelGeneration`, and the screens read that absence rather
 * than a flag of their own.
 */
describe("calling off a queued generation", () => {
  const queued: Generation = { ...stored, id: "gen-3", jobId: "job-3", status: "queued" };

  function CancelProbe() {
    const { gens, cancelGeneration } = useGenerations();
    const gen = gens.find((g) => g.id === "gen-3");
    const [outcome, setOutcome] = useState("-");
    return (
      <>
        <button onClick={() => void cancelGeneration?.("gen-3").then(setOutcome)}>cancel</button>
        <output data-testid="state">{`${gen?.status ?? "?"}|${outcome}|${cancelGeneration ? "offered" : "absent"}`}</output>
      </>
    );
  }

  function renderWith(cancel: AppServices["generation"]["cancel"]) {
    const services = createDemoServices();
    const generation = { ...services.generation, getJob: vi.fn(async () => queuedJob as never) };
    if (cancel) generation.cancel = cancel;
    else delete generation.cancel;
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={{ ...services, generation }}>
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <Generations>
                <CancelProbe />
              </Generations>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
  }

  const queuedJob = {
    id: "job-3",
    status: "queued",
    familyId: "seedance",
    variantId: "v1",
    coins: 4.2,
    prompt: "یک گربه",
    createdAt: 1_000,
    updatedAt: 2_000,
    outputs: [],
    urlsExpireAt: null,
  };

  beforeEach(() => saveGenerations([queued], "u-1"));

  it("marks it cancelled once the server says so", async () => {
    renderWith(vi.fn().mockResolvedValue(undefined));

    await act(async () => screen.getByText("cancel").click());

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("cancelled|cancelled|offered"));
  });

  /* The race the 409 exists for. Nothing local is corrected on it — the poll
     is already asking about this job every second, and it is the one that saw
     the worker take it. */
  it("says the worker got there first, and lets the poll correct the card", async () => {
    const services = createDemoServices();
    let answer: Record<string, unknown> = queuedJob;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider
          services={{
            ...services,
            generation: {
              ...services.generation,
              getJob: vi.fn(async () => answer as never),
              cancel: vi.fn(async () => {
                answer = { ...queuedJob, status: "running" };
                throw new ApiError({ code: "job_started", message: "too late", status: 409 });
              }),
            },
          }}
        >
          <CatalogProvider families={catalog.families}>
            <NavigationProvider>
              <Generations>
                <CancelProbe />
              </Generations>
            </NavigationProvider>
          </CatalogProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );

    await act(async () => screen.getByText("cancel").click());

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("started"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("running|started|offered"), { timeout: 3_000 });
  });

  it("is not offered at all where the API cannot do it", () => {
    renderWith(undefined);

    expect(screen.getByTestId("state")).toHaveTextContent("absent");
  });
});
