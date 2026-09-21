import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures";

/**
 * The port, exercised through the running app rather than through a unit test.
 *
 * The sign-in half now has a screen of its own — see `auth.spec.ts` and
 * `src/screens/Auth.test.tsx`. What stays here is the direction that has no
 * screen: signing out, driven from Profile. It asserts the part a screen depends
 * on and cannot mock — that calling the port moves the whole app between the
 * workspace and the landing page.
 */
test("signing out through the port returns the app to the landing page", async ({ page }) => {
  await mockApi(page);

  let loggedOut = false;
  await page.route("**/api/v1/auth/logout", (route) => {
    loggedOut = true;
    return route.fulfill({ status: 204, body: "" });
  });
  // After logout the session route must answer anonymous, exactly as the real
  // API would once the cookie is cleared.
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        loggedOut
          ? { status: "anonymous", host: "web" }
          : {
              status: "authed",
              host: "web",
              user: { id: "e2e-user", methods: ["email"], emailNormalized: "e2e@vgen.local", displayName: "E2E User" },
            },
      ),
    }),
  );

  await page.goto("/studio/image");
  // Profile is a row inside the account menu now, not a button on the bar. The
  // avatar opens the menu; the balance and the way to top it up live there too.
  await expect(page.getByRole("button", { name: /حساب کاربری/ })).toBeVisible();

  await page.getByRole("button", { name: /حساب کاربری/ }).click();
  await page.getByRole("menuitem", { name: "پروفایل" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByRole("button", { name: "خروج از حساب" }).click();

  // The landing page is what an anonymous session renders, so its heading
  // appearing is the whole assertion: the port ran, the cache cleared, and the
  // gate re-evaluated.
  await expect(page.getByRole("button", { name: /ورود|شروع/ }).first()).toBeVisible({ timeout: 15_000 });
});
