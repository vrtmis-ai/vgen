import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { PRESETS } from "../data/presets";
import { published } from "../data/content";
import { resetAll, withPatches } from "../data/contentStore";
import Admin from "./Admin";

/* The panel's whole promise is that an edit here changes what a user screen
   shows, without a deploy. These tests hold that promise to the two halves it
   is made of: the write reaches the store, and the read path — `published()`,
   which every user screen already calls — sees it. */

function renderPanel() {
  return render(
    <LanguageProvider>
      <Admin onBack={vi.fn()} />
    </LanguageProvider>,
  );
}

/** What the Effects screen would render, given the store's current state. */
function liveEffectTitles(): string[] {
  return published(withPatches(PRESETS)).map((preset) => preset.title);
}

describe("Admin panel", () => {
  beforeEach(() => {
    /* Both, and in this order. The store keeps its patches in a module-level
       variable that is read from storage once at import, so clearing storage
       alone leaves the previous test's edits live in memory — which is exactly
       how the first draft of these tests failed, with a later test finding an
       "انتشار" button where it expected "پنهان". */
    localStorage.clear();
    resetAll();
  });

  it("unpublishing an effect removes it from what user screens read", async () => {
    const user = userEvent.setup();
    const first = published(PRESETS)[0];
    if (!first) throw new Error("Expected at least one published preset");
    expect(liveEffectTitles()).toContain(first.title);

    renderPanel();
    const row = screen.getByText(first.title).closest("div");
    if (!row) throw new Error("Effect row was not rendered");
    await user.click(within(row).getByRole("button", { name: "پنهان" }));

    expect(liveEffectTitles()).not.toContain(first.title);
  });

  it("records who made the change, which cannot be reconstructed later", async () => {
    const user = userEvent.setup();
    const first = published(PRESETS)[0];
    if (!first) throw new Error("Expected at least one published preset");
    expect(first.updatedBy).toBeUndefined();

    renderPanel();
    const row = screen.getByText(first.title).closest("div");
    if (!row) throw new Error("Effect row was not rendered");
    await user.click(within(row).getByRole("button", { name: "پنهان" }));

    const patched = withPatches(PRESETS).find((preset) => preset.id === first.id);
    expect(patched?.updatedBy).toBe("local-admin");
    expect(patched?.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("reordering swaps both rows, so no two records claim one slot", async () => {
    const user = userEvent.setup();
    const before = liveEffectTitles();
    const [firstTitle, secondTitle] = before;
    if (!firstTitle || !secondTitle) throw new Error("Expected at least two published presets");

    renderPanel();
    await user.click(screen.getByRole("button", { name: `پایین بردن ${firstTitle}` }));

    const after = liveEffectTitles();
    expect(after[0]).toBe(secondTitle);
    expect(after[1]).toBe(firstTitle);
    // The rest of the shelf must not have moved.
    expect(after.slice(2)).toEqual(before.slice(2));
  });

  it("a content admin cannot see the money ledger, and commerce cannot see content", async () => {
    const user = userEvent.setup();
    renderPanel();

    // Owner sees both.
    expect(screen.getByText("افکت‌ها")).toBeInTheDocument();
    expect(screen.getByText("دفتر تغییرات مالی")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "محتوا" }));
    expect(screen.getByText("افکت‌ها")).toBeInTheDocument();
    expect(screen.queryByText("دفتر تغییرات مالی")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "فروش" }));
    expect(screen.queryByText("افکت‌ها")).not.toBeInTheDocument();
    expect(screen.getByText("دفتر تغییرات مالی")).toBeInTheDocument();
  });

  it("reverting a reordered row does not leave two records in one slot", async () => {
    const user = userEvent.setup();
    const before = liveEffectTitles();
    const [firstTitle, secondTitle] = before;
    if (!firstTitle || !secondTitle) throw new Error("Expected at least two published presets");

    renderPanel();
    // Move A past B, then revert A alone — A's shipped order is now the value B
    // is patched to hold, so dropping A's patch outright would collide.
    await user.click(screen.getByRole("button", { name: `پایین بردن ${firstTitle}` }));
    await user.click(screen.getByRole("button", { name: `بازگرداندن ${firstTitle} به حالت اولیه` }));

    const orders = withPatches(PRESETS).map((preset) => preset.order);
    expect(new Set(orders).size).toBe(orders.length);
    // And the swap the admin asked for is still in effect, since they reverted
    // one row rather than asking to move a second one back.
    expect(liveEffectTitles().slice(0, 2)).toEqual([secondTitle, firstTitle]);
  });

  it("an edit survives a reload, because a panel that forgets is not one", async () => {
    const user = userEvent.setup();
    const first = published(PRESETS)[0];
    if (!first) throw new Error("Expected at least one published preset");

    const { unmount } = renderPanel();
    const row = screen.getByText(first.title).closest("div");
    if (!row) throw new Error("Effect row was not rendered");
    await user.click(within(row).getByRole("button", { name: "پنهان" }));
    unmount();

    expect(localStorage.getItem("vgen:content-overrides")).toContain(first.id);
    expect(liveEffectTitles()).not.toContain(first.title);
  });
});
