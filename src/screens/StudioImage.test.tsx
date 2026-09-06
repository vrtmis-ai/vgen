import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider } from "../runtime/AppServices";
import { SessionProvider, type Session } from "../runtime/providers/SessionProvider";
import StudioImage from "./StudioImage";

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

function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={createDemoServices()}>
        <LanguageProvider initialLang="fa">
          <CatalogProvider families={catalog.families}>
            <SessionProvider value={ACCOUNT}>
              <StudioImage gens={[]} onGenerate={vi.fn()} onOpenModel={vi.fn()} />
            </SessionProvider>
          </CatalogProvider>
        </LanguageProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
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

  it("offers no upload on a model that takes no file", async () => {
    show();
    await pickFamily(/Seedream/i);

    expect(screen.queryByRole("button", { name: /^افزودن/ })).not.toBeInTheDocument();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });
});
