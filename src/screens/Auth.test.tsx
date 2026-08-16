import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider, type AppServices } from "../runtime/AppServices";
import Auth, { type AuthMode } from "./Auth";

/**
 * Driven against the real demo adapter rather than a hand-written mock.
 *
 * That is the whole claim demo mode makes — a screen built against it behaves
 * the same in production — and a mock of the port would test this file's idea of
 * the port instead of the port. The error branches below are the ones
 * `src/adapters/demo/auth.ts` actually models, so if the adapter's rules change
 * these fail rather than quietly passing against a stale fake.
 *
 * English, so the assertions read as the labels a reviewer sees.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

function renderAuth(services: AppServices, mode: AuthMode = "signin") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider initialLang="en">
        <AppServicesProvider services={services}>
          <Auth mode={mode} />
        </AppServicesProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("the sign-in screen", () => {
  it("asks for the invite code only once the server says it needs one", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }));

    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    // Nothing has asked for an invite yet — someone who already has an account
    // should get through the phone route on one field.
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You need an invite code to continue.");
    await user.type(screen.getByLabelText("Invite code"), "DEEV-EARLY");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
  });

  it("sends a code typed in Persian digits as the digits the contract accepts", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const verifyPhone = vi.spyOn(services.auth, "verifyPhone");
    renderAuth(services);

    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Verification code"), "۱۲۳۴۵۶");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    // OtpCodeSchema is /^\d{6}$/ and the bodies are .strict(), so Persian digits
    // would come back validation_failed with nothing on screen to explain it.
    await waitFor(() => expect(verifyPhone).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" })));
  });

  it("reports a rejected password as a credentials failure, not an invite one", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }));

    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.type(screen.getByLabelText("Email"), "someone@deev.local");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That email or password is wrong.");
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
  });

  it("reports a taken address on the sign-up route", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }), "signup");

    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.type(screen.getByLabelText("Email"), "taken@deev.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That email already has an account.");
  });

  it("sends a visitor who is already signed in back to the app", async () => {
    renderAuth(createDemoServices());

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
  });
});
