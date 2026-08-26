import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

/**
 * The landing page's bar, in a real browser because both of these are layout
 * facts that jsdom cannot hold an opinion about: `getBoundingClientRect` is all
 * zeroes there, and nothing paints, so neither a clipped panel nor a bar with
 * page content on top of it can fail a unit test.
 */

/** Signed out, because `/` is the landing page only for a visitor. */
test.beforeEach(async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");
});

test("a model menu opens fully inside the viewport, however near the edge its item sits", async ({ page }) => {
  // ویدیو sits near the inline-start edge of a right-to-left bar, and its panel
  // is the three-column one — the pair that used to run off the screen with the
  // last column unreachable.
  const trigger = page.getByRole("button", { name: "ویدیو", exact: true });
  await trigger.hover();

  // The caret is its own control, named "مدل‌های ویدیو" — the label button next
  // to it is the destination and carries no panel. A regex over both would match
  // two buttons and resolve to neither.
  const toggle = page.getByRole("button", { name: "مدل‌های ویدیو", exact: true });
  const panelId = await toggle.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();

  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toBeVisible();

  const box = (await panel.boundingBox())!;
  const width = page.viewportSize()!.width;

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);

  // Every column the catalogue gave it is reachable, not just on-screen: the
  // clipped version still "contained" the last column, off the document where
  // no scroll could reach it.
  await expect(panel.getByRole("heading", { name: "ویرایش ویدیو" })).toBeVisible();
});

test("page content scrolls under the bar, not over it", async ({ page }) => {
  /**
   * The bar is `fixed`, but Landing's root is `relative z-10` — a stacking
   * context — so the bar and the page's content are siblings inside it and
   * being fixed wins nothing. The feature bento paints each card's badge row at
   * z-30; at the bar's old z-20 those badges slid across the nav as the page
   * moved, over the wordmark and the sign-in button.
   *
   * The card is driven *to* the bar rather than the page scrolled to a guessed
   * offset. An earlier version scrolled a fixed 260px past `#features` and
   * passed with the bug still in: at that offset the bar happened to have a gap
   * behind it, so the one thing the test was about never got in front of it.
   */
  const glass = page.locator("header nav div.max-w-7xl").first();
  await expect(glass).toBeVisible();

  const badges = page.locator("#features div.z-30").first();
  await expect(badges).toBeAttached();

  const overlap = await page.evaluate(() => {
    const bar = document.querySelector("header nav div.max-w-7xl")!.getBoundingClientRect();
    const chrome = document.querySelector("#features div.z-30")!;
    const midline = bar.top + bar.height / 2;

    // Put the badge row exactly on the bar's midline, wherever that takes us.
    window.scrollBy(0, chrome.getBoundingClientRect().top - midline);
    const box = chrome.getBoundingClientRect();

    const painted = document.elementFromPoint(box.left + box.width / 2, midline);
    return {
      chromeIsOnTheBar: Math.abs(box.top + box.height / 2 - midline) < box.height,
      ownedByHeader: painted ? !!painted.closest("header") : false,
      painted: painted?.className?.toString().slice(0, 60) ?? null,
    };
  });

  // The setup has to have worked, or "nothing covers the bar" is vacuous.
  expect(overlap.chromeIsOnTheBar).toBe(true);
  expect(overlap.ownedByHeader).toBe(true);
});
