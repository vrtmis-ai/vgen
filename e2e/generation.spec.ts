import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

test("quotes and creates a generation with the server price", async ({ page }) => {
  await mockApi(page);
  await page.goto("/generate/z-image");
  await page.getByPlaceholder("Describe what you want to create…").fill("A quiet forest");
  await page.getByRole("button", { name: /^ساخت/ }).click();

  await expect(page.getByText(/هزینهٔ نهایی سرور: ۷/)).toBeVisible();
});

test("shows a safe insufficient-credits error", async ({ page }) => {
  await mockApi(page, { quoteErrorCode: "insufficient_credits" });
  await page.goto("/generate/z-image");
  await page.getByPlaceholder("Describe what you want to create…").fill("A quiet forest");
  await page.getByRole("button", { name: /^ساخت/ }).click();

  await expect(page.getByText(/اعتبار کیف پول/)).toBeVisible();
  await expect(page.getByText("raw provider text")).toHaveCount(0);
});
