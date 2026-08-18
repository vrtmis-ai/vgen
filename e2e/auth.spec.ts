import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

// The header pair is queried by test id rather than by label: both words now
// appear on the feature cards further down the page too, so an accessible-name
// query stopped identifying the header and started matching whatever came first.
test("anonymous users see the landing page", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");
  await expect(page.getByTestId("landing-login")).toBeVisible();
  await expect(page.getByTestId("landing-signup")).toBeVisible();
});

// The two landing buttons open the same screen in different modes, so the thing
// worth pinning is that they stay separate destinations rather than that either
// one merely does something.
test("the landing page's two entry points open the two auth routes", async ({ page }) => {
  await mockApi(page, { anonymous: true });
  await page.goto("/");

  await page.getByTestId("landing-login").click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "ورود به DEEV" })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("landing-signup").click();
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
