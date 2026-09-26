import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
import { AppServicesProvider, type AppServices } from "../runtime/AppServices";
import ResetPassword from "./ResetPassword";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

function renderScreen(services: AppServices, mode: "forgot" | "reset") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider initialLang="en">
        <AppServicesProvider services={services}>
          <ResetPassword mode={mode} />
        </AppServicesProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("asking for a reset link", () => {
  it("says a link is on its way", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const ask = vi.spyOn(services.auth, "requestPasswordReset").mockResolvedValue(undefined);
    renderScreen(services, "forgot");

    await user.type(screen.getByLabelText("Email"), "forgot@example.com");
    await user.click(screen.getByRole("button", { name: "Send the link" }));

    expect(await screen.findByText("SENT")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith("forgot@example.com");
  });

  /* Said plainly rather than hidden behind "if that address exists". The
     waitlist already reveals registration, and silence leaves somebody who
     mistyped their own address waiting for a mail that is never coming. */
  it("says when no account uses the address, instead of pretending to send", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "requestPasswordReset").mockRejectedValue(new ApiError({ code: "no_account", message: "no", status: 404 }));
    renderScreen(services, "forgot");

    await user.type(screen.getByLabelText("Email"), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Send the link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No account uses that address.");
    expect(screen.queryByText("SENT")).not.toBeInTheDocument();
  });
});

describe("opening a reset link", () => {
  it("takes the token out of the address bar before anything else", async () => {
    window.history.replaceState(null, "", "/reset?token=a-secret-token");
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkPasswordReset").mockResolvedValue("usable");
    renderScreen(services, "reset");

    /* The token is a password until it is spent. Left in the URL it lands in
       the history, on a shared screen, and in the Referer of anything the
       page loads next. */
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
  });

  it("refuses an expired link without showing a form to fill in", async () => {
    window.history.replaceState(null, "", "/reset?token=stale");
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkPasswordReset").mockResolvedValue("expired");
    renderScreen(services, "reset");

    expect(await screen.findByText("THIS LINK DOES NOT WORK")).toBeInTheDocument();
    expect(screen.getByText("This link has expired. Links work for one hour.")).toBeInTheDocument();
    // Taking a password and then refusing it is the version worth avoiding.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("catches a typo in the second box without asking the server", async () => {
    window.history.replaceState(null, "", "/reset?token=a-secret-token");
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkPasswordReset").mockResolvedValue("usable");
    const reset = vi.spyOn(services.auth, "resetPassword");
    renderScreen(services, "reset");

    await user.type(await screen.findByLabelText("New password"), "a-brand-new-password");
    await user.type(screen.getByLabelText("Type it again"), "a-brand-new-passwrod");
    await user.click(screen.getByRole("button", { name: "Set the new password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The two passwords do not match.");
    expect(reset).not.toHaveBeenCalled();
  });

  it("sends somebody to sign in rather than signing them in", async () => {
    window.history.replaceState(null, "", "/reset?token=a-secret-token");
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkPasswordReset").mockResolvedValue("usable");
    const reset = vi.spyOn(services.auth, "resetPassword").mockResolvedValue(undefined);
    renderScreen(services, "reset");

    await user.type(await screen.findByLabelText("New password"), "a-brand-new-password");
    await user.type(screen.getByLabelText("Type it again"), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: "Set the new password" }));

    expect(await screen.findByText("PASSWORD CHANGED")).toBeInTheDocument();
    expect(reset).toHaveBeenCalledWith("a-secret-token", "a-brand-new-password");
    /* No session. A reset that signed you in would mean anybody who can read
       the mailbox is inside without ever knowing the password. */
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
  });

  it("turns a link that dies between opening and submitting into the dead-link page", async () => {
    window.history.replaceState(null, "", "/reset?token=a-secret-token");
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkPasswordReset").mockResolvedValue("usable");
    vi.spyOn(services.auth, "resetPassword").mockRejectedValue(new ApiError({ code: "reset_used", message: "used", status: 400 }));
    renderScreen(services, "reset");

    await user.type(await screen.findByLabelText("New password"), "a-brand-new-password");
    await user.type(screen.getByLabelText("Type it again"), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: "Set the new password" }));

    // The check said usable a moment ago; the server is the one that decides.
    expect(await screen.findByText("THIS LINK DOES NOT WORK")).toBeInTheDocument();
    expect(screen.getByText("This link has already been used. Each one works once.")).toBeInTheDocument();
  });

  it("does not show a form when the link carries no token at all", async () => {
    window.history.replaceState(null, "", "/reset");
    const services = createDemoServices({ startAnonymous: true });
    const check = vi.spyOn(services.auth, "checkPasswordReset");
    renderScreen(services, "reset");

    expect(await screen.findByText("THIS LINK DOES NOT WORK")).toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });
});
