import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { AppServicesProvider, type AppServices } from "./app/AppServices";
import { createDemoServices } from "./adapters/demo/demoServices";
import { MemoryRouter } from "react-router-dom";
import { useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./adapters/http/client";

function LocationProbe() {
  return <output aria-label="current-path">{useLocation().pathname}</output>;
}

function renderApp(path: string | string[] = "/studio/video", services: AppServices = createDemoServices({ now: () => 1_000 })) {
  const entries = Array.isArray(path) ? path : [path];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AppServicesProvider services={services}>
            <App />
            <LocationProbe />
          </AppServicesProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Vgen application shell", () => {
  it("shows the authenticated workspace navigation", async () => {
    renderApp();

    expect(await screen.findByRole("button", { name: "ویدیو" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تصویر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "صدا" })).toBeInTheDocument();
  });

  it("opens the image studio directly from its URL", async () => {
    renderApp("/studio/image");

    expect(await screen.findByRole("button", { name: "تصویر" })).toHaveAttribute("aria-current", "page");
  });

  it("puts full-screen profile navigation into browser history", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "پروفایل" }));

    await waitFor(() => expect(screen.getByLabelText("current-path")).toHaveTextContent("/profile"));
  });

  it("returns from a full-screen route to the previous workspace route", async () => {
    const user = userEvent.setup();
    renderApp(["/studio/image", "/profile"]);

    await user.click(await screen.findByRole("button", { name: "بازگشت" }));

    expect(screen.getByLabelText("current-path")).toHaveTextContent("/studio/image");
    expect(await screen.findByRole("button", { name: "تصویر" })).toHaveAttribute("aria-current", "page");
  });

  it("restores a safe prompt from a direct model URL", async () => {
    renderApp("/generate/seedance?prompt=A%20quiet%20forest");

    expect(await screen.findByPlaceholderText("Describe what you want to create…")).toHaveValue("A quiet forest");
  });

  it("redirects unknown results to the gallery", async () => {
    renderApp("/result/not-a-generation");

    await waitFor(() => expect(screen.getByLabelText("current-path")).toHaveTextContent("/gallery"));
  });

  it("retries a failed session request without crashing the application", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ now: () => 1_000 });
    const recoveredSession = await services.session.getCurrent();
    services.session.getCurrent = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ code: "network_error", message: "offline", status: 0, requestId: "req-session" }))
      .mockResolvedValue(recoveredSession);

    renderApp("/studio/video", services);

    expect(await screen.findByRole("heading", { name: "ارتباط با سرویس قطع شد" })).toBeInTheDocument();
    expect(screen.getByText("req-session")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("button", { name: /^ویدیو$/ })).toHaveAttribute("aria-current", "page");
  });

  it("retries wallet data independently after authentication", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ now: () => 1_000 });
    const recoveredWallet = await services.wallet.getCurrent();
    services.wallet.getCurrent = vi.fn().mockRejectedValueOnce(new Error("wallet unavailable")).mockResolvedValue(recoveredWallet);

    renderApp("/studio/video", services);

    expect(await screen.findByRole("heading", { name: "کیف پول بارگذاری نشد" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("button", { name: /^ویدیو$/ })).toHaveAttribute("aria-current", "page");
  });

  it("does not expose a stale workspace when the catalog request fails", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ now: () => 1_000 });
    const recoveredCatalog = await services.catalog.list();
    services.catalog.list = vi.fn().mockRejectedValueOnce(new Error("catalog unavailable")).mockResolvedValue(recoveredCatalog);

    renderApp("/studio/video", services);

    expect(await screen.findByRole("heading", { name: "کاتالوگ مدل‌ها بارگذاری نشد" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("button", { name: /^ویدیو$/ })).toHaveAttribute("aria-current", "page");
  });

  it("renders a real 404 page for an unknown route", async () => {
    const user = userEvent.setup();
    renderApp("/somewhere-that-does-not-exist");

    expect(await screen.findByRole("heading", { name: "این مسیر به جایی نمی‌رسد" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "بازگشت به استودیو" }));
    await waitFor(() => expect(screen.getByLabelText("current-path")).toHaveTextContent("/studio/video"));
  });
});
