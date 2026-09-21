import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { LanguageProvider } from "../lib/i18n";
import { AssetViewer, type ViewerAsset } from "./AssetViewer";

/* ---------------------------------------------------------------------------
   The panel over a finished picture, on the two things that made it useless.

   It rendered inline in the page. useModalSurface marks every direct child of
   <body> except the modal root inert so the rest of the page cannot be reached
   while a dialog is open, and it finds that root with
   closest("[data-modal-root]") — which, for a dialog that is not a child of
   body, matches none of body's children. So all of them were marked inert,
   including the subtree holding the dialog, and inert inherits: the tabs, the
   download and the close button all stopped responding. Escape still worked,
   because that listener is on the document, which is exactly the shape the bug
   was reported in — "none of the buttons do anything".

   The invariant that fixes it is structural and cheap to assert: the dialog is
   a child of <body>. jsdom does not implement what inert does to a click, so
   asserting the clicks would prove nothing here; asserting the condition the
   hook actually requires does.

   Second: the actions have to carry the picture they were pressed on. Both
   "to video" and "use as reference" named a model and dropped the asset.
   --------------------------------------------------------------------------- */

const catalog = await createDemoCatalogService(() => 0).list();

const ASSET: ViewerAsset = {
  id: "gen-1",
  jobId: "job-1",
  url: "blob:preview",
  prompt: "a metal falcon",
  familyId: "recraft",
  w: 2048,
  h: 2048,
  createdAt: 1_700_000_000_000,
};

function show(overrides: Partial<Parameters<typeof AssetViewer>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpenModel: vi.fn(),
    onRegenerate: vi.fn(),
    onDownload: vi.fn(),
  };
  render(
    <LanguageProvider initialLang="fa">
      <CatalogProvider families={catalog.families}>
        <AssetViewer asset={ASSET} {...handlers} {...overrides} />
      </CatalogProvider>
    </LanguageProvider>,
  );
  return handlers;
}

describe("asset viewer", () => {
  it("puts its dialog directly under body, which is what the inert guard needs", () => {
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    // The same condition the hook itself evaluates, asserted the way it does.
    expect(dialog.closest("[data-modal-root]")).toBe(dialog);
    expect(Array.from(document.body.children)).toContain(dialog);
  });

  it("closes when the close button is pressed", async () => {
    const { onClose } = show();
    await userEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("carries the asset into the model it opens", async () => {
    const { onOpenModel } = show();
    await userEvent.click(screen.getByRole("button", { name: /تبدیل به ویدیو/ }));
    // Third argument or the video model opens with an empty first frame.
    expect(onOpenModel).toHaveBeenCalledWith("seedance", ASSET.prompt, ASSET.id);
  });

  it("uses the picture as a reference rather than opening an empty form", async () => {
    const { onOpenModel } = show();
    await userEvent.click(screen.getByRole("button", { name: /به‌عنوان مرجع/ }));
    expect(onOpenModel).toHaveBeenCalledWith(ASSET.familyId, undefined, ASSET.id);
  });

  it("asks to replay the generation rather than to open its model", async () => {
    const { onRegenerate, onOpenModel } = show();
    await userEvent.click(screen.getByRole("button", { name: /دوباره بساز/ }));
    // Not onOpenModel: replaying restores the original *inputs*, where
    // onOpenModel would hand the model this output and no settings.
    expect(onRegenerate).toHaveBeenCalledWith(ASSET);
    expect(onOpenModel).not.toHaveBeenCalled();
  });

  it("offers no control it cannot act on", () => {
    show();
    // The heart, the share and the overflow were markup with no handler and
    // nothing behind them. A button that cannot act is worse than none.
    const dead = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") === null && !button.textContent?.trim());
    expect(dead).toEqual([]);
  });
});
