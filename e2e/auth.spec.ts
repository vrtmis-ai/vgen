import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("anonymous users see the landing page", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "ورود", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "شروع رایگان", exact: true })).toBeVisible();
});

test("authenticated users load the workspace", async ({ page }) => {
  await mockApi(page);
  await page.goto("/studio/video");
  await expect(page.getByRole("button", { name: "ویدیو", exact: true })).toHaveAttribute("aria-current", "page");
});
