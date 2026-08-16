import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("anonymous users see the landing page", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "ورود", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "شروع رایگان", exact: true })).toBeVisible();
});

// The two landing buttons open the same screen in different modes, so the thing
// worth pinning is that they stay separate destinations rather than that either
// one merely does something.
test("the landing page's two entry points open the two auth routes", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");

  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "ورود به DEEV" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "شروع رایگان", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "ساخت حساب" })).toBeVisible();
});

// The screen is reachable without going through the landing page at all — the
// point of putting it on a route rather than behind a flag in the gate.
test("the sign-in screen is a deep link", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/signin");
  await expect(page.getByLabel("شماره موبایل")).toBeVisible();
  await expect(page.getByRole("button", { name: "ارسال کد" })).toBeVisible();
});

test("authenticated users load the workspace", async ({ page }) => {
  await mockApi(page);
  await page.goto("/studio/video");
  await expect(page.getByRole("button", { name: "ویدیو", exact: true })).toHaveAttribute("aria-current", "page");
});
