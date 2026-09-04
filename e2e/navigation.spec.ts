import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("deep links and browser history preserve the active studio", async ({ page }) => {
  await mockApi(page);
  await page.goto("/studio/image");
  await expect(page.getByRole("button", { name: "تصویر", exact: true })).toHaveAttribute("aria-current", "page");

  // Through the account menu — the bar carries the avatar, not a profile link.
  await page.getByRole("button", { name: /حساب کاربری/ }).click();
  await page.getByRole("menuitem", { name: "پروفایل" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/studio\/image$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/profile$/);
});

test("unknown routes show a recoverable 404 page", async ({ page }) => {
  await mockApi(page);
  await page.goto("/this-route-does-not-exist");

  await expect(page.getByRole("heading", { name: "این مسیر به جایی نمی‌رسد" })).toBeVisible();
  await page.getByRole("button", { name: "بازگشت به استودیو" }).click();
  await expect(page).toHaveURL(/\/studio\/video$/);
});
