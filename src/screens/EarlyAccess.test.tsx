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
    const check = vi.spyOn(services.auth, "checkInvite").mockResolvedValue({ valid: false });
    renderPage(services);

    await user.type(screen.getByLabelText("Invite code"), "TOTALLY-FAKE-999");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not valid.");
    expect(check).toHaveBeenCalledWith("TOTALLY-FAKE-999");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sends a visitor with a live code on to signup, code attached", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "checkInvite").mockResolvedValue({ valid: true });
    renderPage(services);

    await user.type(screen.getByLabelText("Invite code"), "  DEEV-WYJPK8 ");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    /* The welcome beat sits between the press and the push, so this waits
       past it rather than asserting on the tick the click returned. */
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Code confirmed")).toBeInTheDocument();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/signup?invite=DEEV-WYJPK8"), { timeout: 4000 });
  });

  /* The done state used to replace the page. Joining the list is one line of
     confirmation under a field that is still there, so somebody who mistyped
     the address can put the right one in without hunting for a way back. */
  it("confirms a waitlist signup in place, leaving the field usable", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const join = vi.spyOn(services.auth, "joinWaitlist").mockResolvedValue(undefined);
    renderPage(services);

    await user.click(screen.getByRole("button", { name: "I don't have a code" }));
    const field = screen.getByLabelText("Email or mobile number");
    await user.type(field, "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Added to the waiting list.");
    expect(join).toHaveBeenCalledWith("someone@example.com");
    expect(field).toHaveValue("");
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

    await user.click(screen.getByRole("button", { name: "I don't have a code" }));
    await user.type(screen.getByLabelText("Email or mobile number"), "09121234567");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    // Normalised before it leaves the page, by the same function the route
    // normalises with, so the four ways to type this number are one row.
    await waitFor(() => expect(join).toHaveBeenCalledWith("09121234567"));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("refuses a stray word without asking the server", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const join = vi.spyOn(services.auth, "joinWaitlist");
    renderPage(services);

    await user.click(screen.getByRole("button", { name: "I don't have a code" }));
    await user.type(screen.getByLabelText("Email or mobile number"), "hello");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(join).not.toHaveBeenCalled();
  });
});
