import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

/**
 * The prompt box, by role rather than by its placeholder text.
 *
 * These tests used to name the English placeholder, which broke the moment the
 * copy changed — and it changed because it was English on a Persian screen and
 * asked for "an image" whatever the model made. It is now one of three strings
 * chosen per kind, so matching the words again would just queue up the same
 * failure. There is exactly one textbox on the create screen.
 */
const promptBox = (page: import("@playwright/test").Page) => page.getByRole("textbox");

test("takes you to your work once the job is accepted", async ({ page }) => {
  await mockApi(page);
  await page.goto("/generate/z-image");
  await promptBox(page).fill("A quiet forest");
  await page.getByRole("button", { name: /^ساخت/ }).click();

  /* The create screen used to stay put and print the server's price under the
     button. Pressing a button that costs money and watching the page not move
     read as a dead button — so a submit now goes where the generation is. */
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByText("A quiet forest")).toBeVisible();
});

test("stays on the form when the quote is refused, with the error", async ({ page }) => {
  await mockApi(page, { quoteErrorCode: "insufficient_credits" });
  await page.goto("/generate/z-image");
  await promptBox(page).fill("A quiet forest");
  await page.getByRole("button", { name: /^ساخت/ }).click();

  /* The other half of the rule above, and the reason it is "on success" rather
     than "on submit": a refusal has something to say, and it has to be said on
     the screen that produced it rather than shouted from a page away. */
  await expect(page).toHaveURL(/\/generate\/z-image$/);
  await expect(page.getByText(/اعتبار کیف پول/)).toBeVisible();
  await expect(page.getByText("raw provider text")).toHaveCount(0);
});
