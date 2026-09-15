import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider, type AppServices } from "../runtime/AppServices";
import EarlyAccess from "./EarlyAccess";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

beforeEach(() => nav.push.mockClear());

function renderPage(services: AppServices) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider initialLang="en">
        <AppServicesProvider services={services}>
          <EarlyAccess />
        </AppServicesProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("the invite page", () => {
  it("keeps a visitor whose code the server refuses, and says why", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const check = vi.spyOn(services.auth, "checkInvite").mockResolvedValue(false);
    renderPage(services);

    await user.type(screen.getByLabelText("Invite code"), "TOTALLY-FAKE-999");
    await user.click(screen.getByRole("button", { name: "Continue with this code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That invite code is not valid");
    expect(check).toHaveBeenCalledWith("TOTALLY-FAKE-999");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sends a visitor with a live code on to signup, code attached", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkInvite").mockResolvedValue(true);
    renderPage(services);

    await user.type(screen.getByLabelText("Invite code"), "  DEEV-WYJPK8 ");
    await user.click(screen.getByRole("button", { name: "Continue with this code" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/signup?invite=DEEV-WYJPK8"));
  });
});
