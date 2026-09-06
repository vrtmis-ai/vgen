import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import type { Generation } from "../lib/gallery";
import Gallery from "./Gallery";

/* ---------------------------------------------------------------------------
   کارهای من, on the two things a refused generation has to say.

   That it did not work is only half of it. The other half is that the coins
   came back — the worker releases the hold and charges zero on every failure
   path there is — and a card that says "انجام نشد" and nothing else leaves the
   customer to work out for themselves whether they were billed. The third
   thing is being able to clear it, which is the request this came from.

   Removal is offered on failures and on nothing else. A finished generation is
   the thing the customer paid for, and a delete control on every tile is one
   mis-tap from destroying it.
   --------------------------------------------------------------------------- */

const base: Generation = {
  id: "g1",
  jobId: "job-1",
  familyId: "seedance",
  variantId: "seedance-1-5-pro",
  name: "Seedance",
  vendor: "ByteDance",
  grad: "linear-gradient(#000,#111)",
  kind: "video",
  prompt: "a small red boat",
  w: 16,
  h: 9,
  status: "done",
  createdAt: 1,
};

const failed: Generation = {
  ...base,
  id: "g2",
  jobId: "job-2",
  status: "failed",
  error: { code: "provider_failed", message: "" },
  createdAt: 2,
};

function show(gens: Generation[], onRemove = vi.fn()) {
  render(
    <LanguageProvider initialLang="fa">
      <Gallery gens={gens} onOpen={vi.fn()} onRemove={onRemove} onBrowse={vi.fn()} />
    </LanguageProvider>,
  );
  return onRemove;
}

describe("a refused generation on the wall", () => {
  it("says the coins came back, and why it failed", () => {
    show([failed]);

    expect(screen.getByText("انجام نشد")).toBeInTheDocument();
    expect(screen.getByText("سکه‌ها برگشت")).toBeInTheDocument();
    // The reason comes from the code, which is the contract — never from the
    // provider's own message, which we do not forward.
    expect(screen.getByText(/ارائه‌دهنده نتوانست این ساخت را کامل کند/)).toBeInTheDocument();
  });

  it("can be removed", async () => {
    const onRemove = show([failed]);

    await userEvent.click(screen.getByRole("button", { name: "حذف از کارهای من" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls[0]?.[0]).toMatchObject({ id: "g2" });
  });

  it("leaves finished work alone", () => {
    show([base]);

    expect(screen.queryByRole("button", { name: "حذف از کارهای من" })).not.toBeInTheDocument();
    expect(screen.queryByText("سکه‌ها برگشت")).not.toBeInTheDocument();
  });
});
