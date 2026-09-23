import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AdminApi } from "../../features/admin/adminApi";
import { OpsSection } from "./OpsSection";

const failure = {
  id: "0192f7a0-0000-7000-8000-00000000000e",
  at: Date.now() - 7_200_000,
  status: "failed",
  customer: "sara@example.test",
  variantId: "flux-2-pro-edit",
  errorCode: "provider_error",
  errorMessage: "KIE returned 500",
  refunded: true,
  attempts: 2,
};

function renderSection(
  canWriteFx = true,
  rate: { rialPerUsd: number; validFrom: number; source: string | null } | null = {
    rialPerUsd: 2_289_810,
    validFrom: Date.now() - 3_600_000,
    source: "wallex",
  },
) {
  const api = {
    listFailures: vi.fn(async () => [failure]),
    listAuditTrail: vi.fn(async () => [
      {
        id: "a1",
        at: Date.now() - 600_000,
        actor: "admin@deev.test",
        action: "content.create",
        targetType: "preset",
        targetId: "fx-1234abcd",
        after: { code: "fx-1234abcd", status: "published" },
      },
    ]),
    getFxRate: vi.fn(async () => rate),
    refreshFxRate: vi.fn(async () => ({ rialPerUsd: 2_300_000, validFrom: Date.now(), source: "wallex" })),
    setFxRate: vi.fn(async () => ({ rialPerUsd: 2_500_000, validFrom: Date.now(), source: "manual" })),
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OpsSection api={api as unknown as AdminApi} canWriteFx={canWriteFx} />
    </QueryClientProvider>,
  );
  return api;
}

describe("the operations page", () => {
  it("prints the rate in Toman, which is what the table stores a tenth of", async () => {
    renderSection();

    // 2,289,810 Rial per dollar is 228,981 Toman — the number everyone quotes.
    expect(await screen.findByText("228,981")).toBeInTheDocument();
    expect(screen.getByText(/wallex/)).toBeInTheDocument();
  });

  it("asks the market, and takes a rate by hand", async () => {
    const api = renderSection();
    await screen.findByText("228,981");

    await userEvent.click(screen.getByRole("button", { name: "تازه‌سازی از بازار" }));
    await waitFor(() => expect(api.refreshFxRate).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText("نرخ دستی به تومان"), "240000");
    await userEvent.click(screen.getByRole("button", { name: "ثبت دستی" }));

    await waitFor(() => expect(api.setFxRate).toHaveBeenCalledWith(240000));
  });

  it("refuses a hand-typed rate that is not a plausible number of Toman", async () => {
    const api = renderSection();
    await screen.findByText("228,981");

    await userEvent.type(screen.getByLabelText("نرخ دستی به تومان"), "12");

    expect(screen.getByRole("button", { name: "ثبت دستی" })).toBeDisabled();
    expect(api.setFxRate).not.toHaveBeenCalled();
  });

  it("says a hand-set rate will be replaced, so nobody thinks it is pinned", async () => {
    renderSection(true, { rialPerUsd: 2_400_000, validFrom: Date.now(), source: "manual" });

    expect(await screen.findByText(/اولین به‌روزرسانی موفق بعدی جایش را می‌گیرد/)).toBeInTheDocument();
  });

  it("shows a failed generation with the provider's own words and whether the coins came back", async () => {
    renderSection();

    expect(await screen.findByText("provider_error")).toBeInTheDocument();
    expect(screen.getByText("KIE returned 500")).toBeInTheDocument();
    expect(screen.getByText("برگشت")).toBeInTheDocument();
    expect(screen.getByText("flux-2-pro-edit")).toBeInTheDocument();
  });

  it("lists the audit log, which nothing has ever read", async () => {
    const api = renderSection();

    expect(await screen.findByText("content.create")).toBeInTheDocument();
    expect(screen.getByText("admin@deev.test")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("فیلتر دفتر تغییرات"), "staff.");
    await waitFor(() => expect(api.listAuditTrail).toHaveBeenLastCalledWith("staff."));
  });

  it("offers no rate controls without fx.write", async () => {
    renderSection(false);
    await screen.findByText("228,981");

    expect(screen.queryByRole("button", { name: "تازه‌سازی از بازار" })).not.toBeInTheDocument();
  });
});
