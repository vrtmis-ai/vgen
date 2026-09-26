import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
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
    const check = vi.spyOn(services.auth, "checkInvite").mockResolvedValue({ valid: false });
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
    vi.spyOn(services.auth, "checkInvite").mockResolvedValue({ valid: true });
    renderPage(services);

    await user.type(screen.getByLabelText("Invite code"), "  DEEV-WYJPK8 ");
    await user.click(screen.getByRole("button", { name: "Continue with this code" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/signup?invite=DEEV-WYJPK8"));
  });

  /* The half that shipped without a server. `POST /auth/waitlist` was a 404 for
     three days, so every visitor who pressed this got «something went wrong»
     on the one page whose entire job is to let them in. These cover the page's
     side of the contract the route now answers. */
  it("puts somebody with no code on the list, and says so", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const join = vi.spyOn(services.auth, "joinWaitlist").mockResolvedValue(undefined);
    renderPage(services);

    await user.click(screen.getByRole("button", { name: "No code? Join the queue" }));
    await user.type(screen.getByLabelText("Email or mobile number"), "09121234567");
    await user.click(screen.getByRole("button", { name: "Join the queue" }));

    // Normalised before it leaves the page, by the same function the route
    // normalises with, so the four ways to type this number are one row.
    await waitFor(() => expect(join).toHaveBeenCalledWith("09121234567"));
    expect(nav.push).not.toHaveBeenCalled();
  });

  /* Somebody with an account who joins the queue is waiting for a mail that
     will never come — the invite picker passes over them, by design. Telling
     them costs an enumeration oracle on an open form, which the owner weighed
     against leaving them waiting. The rate limit is what bounds it. */
  it("tells somebody who already has an account to sign in", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "joinWaitlist").mockRejectedValue(
      new ApiError({ code: "account_exists", message: "already a member", status: 409 }),
    );
    renderPage(services);

    await user.click(screen.getByRole("button", { name: "No code? Join the queue" }));
    await user.type(screen.getByLabelText("Email or mobile number"), "member@example.com");
    await user.click(screen.getByRole("button", { name: "Join the queue" }));

    // Not the generic failure, and not the done state either: the page must
    // not congratulate somebody on joining a queue they were kept out of.
    expect(await screen.findByRole("alert")).toHaveTextContent("That address already has an account. Sign in instead.");
    expect(screen.queryByText("YOU ARE ON THE LIST")).not.toBeInTheDocument();
  });

  it("refuses a stray word without asking the server", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const join = vi.spyOn(services.auth, "joinWaitlist");
    renderPage(services);

    await user.click(screen.getByRole("button", { name: "No code? Join the queue" }));
    await user.type(screen.getByLabelText("Email or mobile number"), "hello");
    await user.click(screen.getByRole("button", { name: "Join the queue" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(join).not.toHaveBeenCalled();
  });
});
