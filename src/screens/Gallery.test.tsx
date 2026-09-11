import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import type { Generation } from "../lib/gallery";
import { AppServicesProvider } from "../runtime/AppServices";
import { createDemoServices } from "../adapters/demo/demoServices";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import Gallery from "./Gallery";

/* ---------------------------------------------------------------------------
   کارهای من, on the two things a refused generation has to say.

   That it did not work is only half of it. The other half is that the coins
   came back — the worker releases the hold and charges zero on every failure
   path there is — and a card that says "انجام نشد" and nothing else leaves the
   customer to work out for themselves whether they were billed. The third
   thing is being able to clear it, which is the request this came from.

   Removal is offered on failures and on nothing else. A finished generation is
   the thing the customer paid for, and a delete control on every tile is one
   mis-tap from destroying it.
   --------------------------------------------------------------------------- */

const base: Generation = {
  id: "g1",
  jobId: "job-1",
  familyId: "seedance",
  variantId: "seedance-1-5-pro",
  name: "Seedance",
  vendor: "ByteDance",
  grad: "linear-gradient(#000,#111)",
  kind: "video",
  prompt: "a small red boat",
  w: 16,
  h: 9,
  status: "done",
  createdAt: 1,
};

const failed: Generation = {
  ...base,
  id: "g2",
  jobId: "job-2",
  status: "failed",
  error: { code: "provider_failed", message: "" },
  createdAt: 2,
};

const catalog = await createDemoCatalogService(() => 0).list();

/** A generation with a file behind it, which is what opens the panel. */
const finished: Generation = { ...base, outputUrl: "blob:the-file", outW: 1920, outH: 1080 };

function mount(gens: Generation[], handlers: Partial<Parameters<typeof Gallery>[0]> = {}) {
  const props = { onOpen: vi.fn(), onOpenModel: vi.fn(), onRegenerate: vi.fn(), onRemove: vi.fn(), onBrowse: vi.fn(), ...handlers };
  render(
    <AppServicesProvider services={createDemoServices()}>
      <LanguageProvider initialLang="fa">
        <CatalogProvider families={catalog.families}>
          <Gallery gens={gens} {...props} />
        </CatalogProvider>
      </LanguageProvider>
    </AppServicesProvider>,
  );
  return props;
}

function show(gens: Generation[], onRemove = vi.fn()) {
  mount(gens, { onRemove });
  return onRemove;
}

describe("a refused generation on the wall", () => {
  it("says the coins came back, and why it failed", () => {
    show([failed]);

    expect(screen.getByText("انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("سکه‌ها برگشت")).toBeInTheDocument();
    // The reason comes from the code, which is the contract — never from the
    // provider's own message, which we do not forward.
    expect(screen.getByText(/ارائه‌دهنده نتوانست این ساخت را کامل کند/)).toBeInTheDocument();
  });

  it("can be removed", async () => {
    const onRemove = show([failed]);

    await userEvent.click(screen.getByRole("button", { name: "حذف از کارهای من" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0]?.[0]).toMatchObject({ id: "g2" });
  });

  it("leaves finished work alone", () => {
    show([base]);

    expect(screen.queryByRole("button", { name: "حذف از کارهای من" })).not.toBeInTheDocument();
    expect(screen.queryByText("سکه‌ها برگشت")).not.toBeInTheDocument();
  });

  /* The wall used to send every card to the result page, so the same picture
     offered a download, a reference and a replay in the studio and none of them
     here. It is the same file either way. */
  it("opens the same panel the studio does", async () => {
    const { onOpen } = mount([finished]);

    await userEvent.click(screen.getByRole("button", { name: /a small red boat/ }));

    expect(screen.getByRole("dialog", { name: "نمایش دارایی" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /دانلود/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /دوباره بساز/ })).toBeInTheDocument();
    // The result page is for the ones with nothing to show.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("sends a job with no file to the result page, which can say why", async () => {
    const { onOpen } = mount([failed]);

    await userEvent.click(screen.getByRole("button", { name: /a small red boat/ }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("replays a generation by its own id and model", async () => {
    const { onRegenerate } = mount([finished]);

    await userEvent.click(screen.getByRole("button", { name: /a small red boat/ }));
    await userEvent.click(screen.getByRole("button", { name: /دوباره بساز/ }));

    expect(onRegenerate).toHaveBeenCalledWith("seedance", "g1");
  });
});
