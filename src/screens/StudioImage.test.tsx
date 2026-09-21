import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider } from "../runtime/AppServices";
import { SessionProvider, type Session } from "../runtime/providers/SessionProvider";
import type { Generation } from "../lib/gallery";
import StudioImage from "./StudioImage";
import { FailedVeil } from "../components/GenerationVeils";
import type { GenerationRefusal } from "../features/generation/validation";

/* ---------------------------------------------------------------------------
   The image dock's one required input.

   Recraft and Topaz declare a slot the provider will not run without. The dock
   drew a `+` button with no handler behind it, no file input and no slot on
   screen at all — so on those models the create button was permanently dead and
   the surface offered no way to make it live and no sentence about why. This is
   the pair of claims that has to keep holding: the button reaches a real file
   input, and the reason is written down while the file is missing.
   --------------------------------------------------------------------------- */

const catalog = await createDemoCatalogService(() => 0).list();

const ACCOUNT: Session = {
  user: { id: "u1", methods: [], emailNormalized: "someone@example.com" },
  wallet: { spendable: 500, grants: [], tier: 3 },
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

function show(gens: Generation[] = [], onRemove = vi.fn(), submitError?: GenerationRefusal) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={createDemoServices()}>
        <LanguageProvider initialLang="fa">
          <CatalogProvider families={catalog.families}>
            <SessionProvider value={ACCOUNT}>
              <StudioImage
                gens={gens}
                onGenerate={vi.fn()}
                onOpenModel={vi.fn()}
                onRemove={onRemove}
                submitError={submitError ?? null}
                onErrorAction={vi.fn()}
              />
            </SessionProvider>
          </CatalogProvider>
        </LanguageProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
  return { onRemove };
}

/** Switch the dock onto a family by name, through the picker the user uses. */
async function pickFamily(name: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /مدل|Seedream|Nano|Flux|Recraft|Z-?Image/i }));
  await user.click(await screen.findByRole("button", { name }));
  return user;
}

describe("the image studio's input slot", () => {
  it("says which file the model is waiting for, and offers a real picker for it", async () => {
    show();
    const user = await pickFamily(/Recraft/i);

    // The sentence names the model, because the dock is one click from being a
    // different one and the answer changes with it.
    expect(await screen.findByText(/روی یک تصویر کار می‌کند/)).toBeInTheDocument();

    const picker = document.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(picker.accept).toBe("image/*");
    // Recraft's slot holds one image, and the input has to say so or the OS
    // dialog offers a multi-select the slot would then silently drop.
    expect(picker.multiple).toBe(false);

    /* The report was "the button does not work", and it was literally true —
       no handler, nothing behind it. Asserting the input exists would not have
       caught that, so this asserts the press reaches it. */
    const opened = vi.spyOn(picker, "click");
    await user.click(screen.getByRole("button", { name: /^افزودن/ }));
    expect(opened).toHaveBeenCalled();
  });

  it("stops saying it once a file is attached, and lets the generation start", async () => {
    show();
    const user = await pickFamily(/Recraft/i);

    await user.upload(document.querySelector<HTMLInputElement>("input[type=file]")!, new File(["png"], "in.png", { type: "image/png" }));

    expect(screen.queryByText(/روی یک تصویر کار می‌کند/)).not.toBeInTheDocument();
    // The file is the whole request on this model — nothing is typed above,
    // and nothing needs to be.
    expect(screen.getByRole("button", { name: /بساز/ })).toBeEnabled();
  });

  /* Recraft upscales or cuts out the picture it is handed; it reads no prompt.
     The dock asked for one anyway and sent it — a real job went up carrying
     `prompt: "recraft this"`. KIE ignores the stray field, so this is about not
     asking the customer for something that cannot affect their result. */
  it("does not ask for a prompt on a model that reads none", async () => {
    show();
    await pickFamily(/Recraft/i);

    const box = screen.getByRole("textbox");
    expect(box).toBeDisabled();
    expect(box.getAttribute("placeholder")).toMatch(/پرامپت نمی‌گیرد/);
  });

  /* The picture is what says "edit this": the customer picked GPT Image 2.5
     Flare, not a second row called ویرایش (#96). The dock used to clear its
     files whenever the running variant changed — and attaching a picture is
     what changes it here — so the picture that chose the edit entrance was
     thrown away and the plain row ran instead. */
  it("submits the edit entrance once a picture is attached", async () => {
    const onGenerate = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={createDemoServices()}>
          <LanguageProvider initialLang="fa">
            <CatalogProvider families={catalog.families}>
              <SessionProvider value={ACCOUNT}>
                <StudioImage
                  gens={[]}
                  onGenerate={onGenerate}
                  onOpenModel={vi.fn()}
                  onRemove={vi.fn()}
                  submitError={null}
                  onErrorAction={vi.fn()}
                />
              </SessionProvider>
            </CatalogProvider>
          </LanguageProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );
    // Flare is GPT Image's first version, so picking the model lands on it.
    const user = await pickFamily(/GPT Image/i);

    await user.upload(document.querySelector<HTMLInputElement>("input[type=file]")!, new File(["png"], "in.png", { type: "image/png" }));
    await user.type(screen.getByRole("textbox"), "a violet sky");
    await user.click(screen.getByRole("button", { name: /بساز/ }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    const [, variant, , , , refs] = onGenerate.mock.calls[0]!;
    expect(variant.id).toBe("gpt-image-2-5-flare-edit");
    // Under the entrance's own field name, not the role the dock held it by.
    expect(Object.keys(refs as Record<string, unknown>)).toEqual(["input_urls"]);
  });

  it("offers no upload on a model that takes no file", async () => {
    show();
    await pickFamily(/Seedream/i);

    expect(screen.queryByRole("button", { name: /^افزودن/ })).not.toBeInTheDocument();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
   What the wall says about work that is not a picture.

   «بساز» used to send the browser to کارهای من, so this wall could leave
   refusals out and nobody lost track of one. It stays on the page now, which
   makes the wall the only place somebody is looking when a job is refused —
   so a refusal is a tile here, with the reason, and it can be cleared.
   --------------------------------------------------------------------------- */

describe("the image wall, for jobs with no picture", () => {
  const job = (over: Partial<Generation>): Generation => ({
    id: "g1",
    jobId: "job-1",
    familyId: "nano-banana",
    variantId: "nano-banana-pro",
    name: "Nano Banana",
    vendor: "Google",
    grad: "linear-gradient(#000,#111)",
    kind: "image",
    prompt: "a lime lantern",
    w: 1,
    h: 1,
    status: "running",
    createdAt: 1,
    ...over,
  });

  // The wall measures its own width to lay out rows, and jsdom measures 0.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1200, height: 800 } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps a refused job on the wall, says why, and lets it be cleared", async () => {
    const refused = job({ status: "failed", error: { code: "content_policy", message: "" } });
    const { onRemove } = show([refused]);

    expect(screen.getByText("انجام نشد:")).toBeInTheDocument();
    // The code's own sentence — the one that tells somebody to change the words.
    expect(screen.getByText(/متن را عوض کنید/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^حذف از کارهای من/ }));
    expect(onRemove).toHaveBeenCalledWith(refused);
  });

  /* Nothing on the server reports progress, so every real job has none, and
     the bar used to sit at ۰٪ for as long as the job ran — which reads as
     stalled. The moving field says it is working; no number is invented. */
  it("draws a running job without claiming a percentage nobody sent", () => {
    show([job({ status: "running" })]);

    expect(screen.getByText(/در حال ساخت/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/٪/)).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   Where the refusal lands.

   Every dock in this product is pinned to the floor of its panel, so a notice
   added underneath the create button pushes the button upwards — 52px in this
   one, measured — and the thing you just pressed moves out from under the
   pointer while the answer appears in the last strip of the window. Above it,
   the panel grows the other way and nothing moves. The order in the document is
   the whole claim, so that is what is asserted.
   --------------------------------------------------------------------------- */
describe("a refusal in the image dock", () => {
  const refusal: GenerationRefusal = { code: "insufficient_credits", message: "اعتبار کیف پول برای این ساخت کافی نیست." };

  it("is drawn above the create button, not below it", () => {
    show([], vi.fn(), refusal);

    const notice = screen.getByRole("status");
    const create = screen.getByRole("button", { name: /بساز/ });

    expect(notice).toHaveTextContent("اعتبار کیف پول");
    // DOCUMENT_POSITION_FOLLOWING: the button comes after the notice.
    expect(notice.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the way out the code names", async () => {
    show([], vi.fn(), refusal);

    expect(await screen.findByRole("button", { name: "شارژ کیف پول" })).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   The reason, on a tile with no room for it.

   The wall's tiles shrink with the density control and with the window, and
   below 110px the refusal keeps only its status word. `title` carried the
   sentence, which is a tooltip, which is a thing a phone does not have — so on
   the screen where the tiles are smallest, nobody could find out why.
   --------------------------------------------------------------------------- */
describe("a refused tile too short to print the reason", () => {
  const refused: Generation = {
    id: "g-short",
    jobId: "job-short",
    familyId: "nano-banana",
    variantId: "nano-banana-pro",
    name: "Nano Banana",
    vendor: "Google",
    grad: "linear-gradient(#000,#111)",
    kind: "image",
    prompt: "a portrait",
    w: 1,
    h: 1,
    status: "failed",
    error: { code: "content_policy", message: "" },
    createdAt: 5,
  };

  it("opens the sentence on a press rather than only on hover", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppServicesProvider services={createDemoServices()}>
          <LanguageProvider initialLang="fa">
            <FailedVeil gen={refused} lines={0} />
          </LanguageProvider>
        </AppServicesProvider>
      </QueryClientProvider>,
    );

    const opener = screen.getByRole("button", { name: /انجام نشد — چرا/ });
    expect(screen.queryByText(/این درخواست پذیرفته نشد/)).toBeNull();

    await userEvent.click(opener);

    expect(screen.getByText(/این درخواست پذیرفته نشد/)).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   An empty wallet, answered by the press.

   No model belongs to a plan any more, so the only thing between a press and a
   generation is the price against the balance. That could disable the button,
   and did — but a dark primary control is the one thing on a dock that cannot
   say why it is dark, and the dock sits under a thumb on a phone where there
   is no hover to recover it. So the button stays lit, the press is what asks,
   and the answer is the notice every other refusal already draws, with the
   wallet one tap away. Nothing goes to the API: the sum is local.
   --------------------------------------------------------------------------- */

const BROKE: Session = { ...ACCOUNT, wallet: { spendable: 0.01, grants: [], tier: 1 } };

function showWithWallet(session: Session) {
  const onGenerate = vi.fn();
  const onErrorAction = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppServicesProvider services={createDemoServices()}>
        <LanguageProvider initialLang="fa">
          <CatalogProvider families={catalog.families}>
            <SessionProvider value={session}>
              <StudioImage gens={[]} onGenerate={onGenerate} onOpenModel={vi.fn()} onRemove={vi.fn()} onErrorAction={onErrorAction} />
            </SessionProvider>
          </CatalogProvider>
        </LanguageProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
  return { onGenerate, onErrorAction };
}

describe("pressing create with too few coins", () => {
  /* jsdom has no `matchMedia`, and the ignition asks it whether to skip the
     field before it schedules the submit — without this the press throws
     inside the handler and the job is never sent. */
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says nothing until the press", async () => {
    showWithWallet(BROKE);
    await userEvent.type(screen.getByPlaceholderText(/توصیف/), "یک گربه");

    // The price is already on the button; a standing red notice would nag
    // somebody who is still writing.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /بساز/ })).toBeEnabled();
  });

  it("answers the press instead of starting a job, and offers the wallet", async () => {
    const { onGenerate, onErrorAction } = showWithWallet(BROKE);
    await userEvent.type(screen.getByPlaceholderText(/توصیف/), "یک گربه");

    await userEvent.click(screen.getByRole("button", { name: /بساز/ }));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("موجودی‌ات");

    await userEvent.click(screen.getByRole("button", { name: "شارژ کیف پول" }));
    expect(onErrorAction).toHaveBeenCalledWith("wallet");
  });

  it("starts the job when the wallet covers it", async () => {
    const { onGenerate } = showWithWallet(ACCOUNT);
    await userEvent.type(screen.getByPlaceholderText(/توصیف/), "یک گربه");

    await userEvent.click(screen.getByRole("button", { name: /بساز/ }));

    /* Awaited, because the press lights the field first and hands the job over
       when the sweep reaches the far edge — see `useIgnition`. */
    await waitFor(() => expect(onGenerate).toHaveBeenCalled(), { timeout: 4_000 });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
