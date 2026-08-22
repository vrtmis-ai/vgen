import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
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

// The screen holds the collapse animation for 900ms before navigating, so the
// default 1s waitFor window would be a coin flip on a loaded machine.
const LANDED = { timeout: 3000 };

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

/** Typing runs through the keyboard, not one box, because focus advances itself. */
async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(await screen.findByLabelText("Digit 1 of 6"));
  await user.keyboard(code);
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

    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You need an invite code to continue.");
    await user.type(screen.getByLabelText("Invite code"), "DEEV-EARLY");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"), LANDED);
  });

  it("sends a code typed in Persian digits as the digits the contract accepts", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const verifyPhone = vi.spyOn(services.auth, "verifyPhone");
    renderAuth(services);

    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await typeCode(user, "۱۲۳۴۵۶");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));

    // OtpCodeSchema is /^\d{6}$/ and the bodies are .strict(), so Persian digits
    // would come back validation_failed with nothing on screen to explain it.
    await waitFor(() => expect(verifyPhone).toHaveBeenCalledWith(expect.objectContaining({ code: "123456" })));
  });

  it("keeps the verify button shut until all six boxes are filled", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }));

    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await typeCode(user, "123");
    expect(screen.getByRole("button", { name: "Verify and sign in" })).toBeDisabled();

    await user.keyboard("456");
    expect(screen.getByRole("button", { name: "Verify and sign in" })).toBeEnabled();
  });

  it("fills the whole row from one paste, the way a code arrives", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }));

    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await user.click(await screen.findByLabelText("Digit 1 of 6"));
    await user.paste("123456");

    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("6");
    expect(screen.getByRole("button", { name: "Verify and sign in" })).toBeEnabled();
  });

  it("reports a rejected password as a credentials failure, not an invite one", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }));

    await user.click(screen.getByRole("button", { name: "Use email instead" }));
    await user.type(screen.getByLabelText("Email"), "someone@deev.local");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That email or password is wrong.");
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
  });

  it("reports a taken address on the sign-up route", async () => {
    const user = userEvent.setup();
    renderAuth(createDemoServices({ startAnonymous: true }), "signup");

    await user.click(screen.getByRole("button", { name: "Use email instead" }));
    await user.type(screen.getByLabelText("Email"), "taken@deev.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That email already has an account.");
  });

  it("sends a visitor who is already signed in back to the app", async () => {
    renderAuth(createDemoServices());

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"), LANDED);
  });

  it("hands the browser to a provider when its button is pressed", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    const startProviderSignIn = vi.spyOn(services.auth, "startProviderSignIn");
    renderAuth(services);

    // `find`, not `get`: the buttons appear only once the session has said
    // which providers this server has. Before that there is nothing true to
    // draw, and drawing both was the bug.
    await user.click(await screen.findByRole("button", { name: "Continue with Microsoft" }));

    // The id, not the label — in production this becomes a path segment.
    await waitFor(() => expect(startProviderSignIn).toHaveBeenCalledWith("microsoft"));
  });

  it("draws each provider's own mark, in its own colours", async () => {
    const services = createDemoServices({ startAnonymous: true });
    renderAuth(services);

    const google = await screen.findByRole("button", { name: "Continue with Google" });
    const microsoft = await screen.findByRole("button", { name: "Continue with Microsoft" });

    // Four paths each, because both marks are four-part: rendering one of them
    // draws a quarter of a logo, which reads as a glitch rather than a brand.
    // And the fills are the companies' own, not `currentColor` — a monochrome
    // Microsoft mark is four grey squares, indistinguishable from an icon for
    // "grid". The whole point of a real mark here is that it is recognised.
    const fills = (button: HTMLElement) => [...button.querySelectorAll("svg path")].map((path) => path.getAttribute("fill"));

    expect(fills(google)).toEqual(["#4285F4", "#34A853", "#FBBC05", "#EA4335"]);
    expect(fills(microsoft)).toEqual(["#F25022", "#7FBA00", "#00A4EF", "#FFB900"]);

    // The name still comes from the text, not the mark: it is aria-hidden, so
    // nobody hears the brand twice.
    expect(google.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("draws no button for a provider the server does not offer", async () => {
    const services = createDemoServices({ startAnonymous: true });
    // A deployment with Google credentials and no Microsoft ones — the exact
    // asymmetry that used to send half the visitors into a 404.
    vi.spyOn(services.session, "getCurrent").mockResolvedValue({ status: "anonymous", host: "web", authProviders: ["google"] });
    renderAuth(services);

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Microsoft" })).not.toBeInTheDocument();
  });

  it("hides the whole social block when the server offers nothing", async () => {
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.session, "getCurrent").mockResolvedValue({ status: "anonymous", host: "web", authProviders: [] });
    renderAuth(services);

    // The phone form is the proof the screen rendered at all, so an empty
    // social block is what is being asserted rather than an empty screen.
    expect(await screen.findByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it("says how long to wait when the server tells it", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "login").mockRejectedValue(
      new ApiError({ code: "rate_limited", message: "slow down", status: 429, retryAfterMs: 90_000 }),
    );
    renderAuth(services);

    await user.click(screen.getByRole("button", { name: "Use email instead" }));
    await user.type(screen.getByLabelText("Email"), "someone@deev.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // Retry-After is on the error already; "wait a moment" while holding the
    // number is the answer this replaced.
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 1:30.");
  });

  it("tells someone their account is suspended instead of asking them to retry", async () => {
    const user = userEvent.setup();
    const services = createDemoServices({ startAnonymous: true });
    vi.spyOn(services.auth, "login").mockRejectedValue(new ApiError({ code: "account_suspended", message: "suspended", status: 403 }));
    renderAuth(services);

    await user.click(screen.getByRole("button", { name: "Use email instead" }));
    await user.type(screen.getByLabelText("Email"), "someone@deev.local");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This account is suspended.");
  });
});

/**
 * The code's minute, which is also the resend cooldown's minute.
 *
 * Fake timers because the alternative is a test that really waits sixty seconds.
 * `shouldAdvanceTime` keeps the microtask-driven parts of react-query and the
 * demo adapter moving on their own; only the countdown's interval is pushed by
 * hand.
 */
describe("the code's minute", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function sendCode() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAuth(createDemoServices({ startAnonymous: true }));
    await user.type(screen.getByLabelText("Mobile number"), "09123456789");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Digit 1 of 6");
    return user;
  }

  /**
   * The clock and the timers have to move together.
   *
   * The countdown is derived from `Date.now()` on every render rather than
   * decremented, which is what keeps it honest when a tab is backgrounded and
   * misses ticks — so advancing the interval alone re-renders the same number
   * forever. `setSystemTime` moves what the component reads; `advanceTimersByTime`
   * fires the interval that makes it read again.
   */
  async function passTime(ms: number) {
    await act(async () => {
      vi.setSystemTime(Date.now() + ms);
      vi.advanceTimersByTime(ms);
    });
  }

  it("closes the form when the code runs out, and leaves resend as the way on", async () => {
    await sendCode();

    expect(screen.getByLabelText("Digit 1 of 6")).toBeEnabled();
    // Named for what it is doing: counting, and refusing, until the code dies.
    expect(screen.getByRole("button", { name: /Send again in/ })).toBeDisabled();

    await passTime(61_000);

    // Dead code, dead boxes: the screen stops inviting a keystroke it would
    // reject. Resend unlocks on the same tick, so there is no state where the
    // code is expired and nothing can be done about it.
    expect(await screen.findByRole("alert")).toHaveTextContent("That code has run out.");
    expect(screen.getByLabelText("Digit 1 of 6")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify and sign in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled();
  });

  it("lets expiry overrule the wrong-code message it arrives after", async () => {
    const user = await sendCode();

    await user.click(screen.getByLabelText("Digit 1 of 6"));
    await user.paste("111111");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right.");

    await passTime(61_000);

    // Leaving the older message up would tell someone to correct a code in boxes
    // that are now disabled — advice they cannot take, about the wrong problem.
    expect(await screen.findByRole("alert")).toHaveTextContent("That code has run out.");
  });
});
