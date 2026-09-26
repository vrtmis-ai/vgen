import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_COOKIE, serializeConsent } from "./cookies";

/**
 * The rule under test: **PostHog does not start, and so sends nothing, until the
 * visitor has said yes** — and a refusal, a withdrawal or a logout must not
 * quietly change that in either direction.
 */

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  has_opted_in_capturing: vi.fn(() => true),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: sdk }));

const setConsent = (analytics: boolean | null) => {
  document.cookie = analytics === null ? `${CONSENT_COOKIE}=;path=/;max-age=0` : `${CONSENT_COOKIE}=${serializeConsent(analytics)};path=/`;
};

/** A fresh module each time: `started` and `userId` are module state. */
async function load(token: string | null = "phc_test") {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (token) vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", token);
  return import("./analytics");
}

beforeEach(() => {
  Object.values(sdk).forEach((fn) => fn.mockReset());
  // What an initialised SDK reports until somebody has opted it out.
  sdk.has_opted_in_capturing.mockReturnValue(true);
  setConsent(null);
  localStorage.clear();
});

describe("starting", () => {
  it("does not start PostHog at all when nobody has answered", async () => {
    const { startAnalytics, track } = await load();
    startAnalytics();
    track("x");
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it("does not start it for someone who declined either", async () => {
    setConsent(false);
    const { startAnalytics } = await load();
    startAnalytics();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("starts it, through our own origin and without flags or surveys, for someone who said yes", async () => {
    setConsent(true);
    const { startAnalytics, track } = await load();
    startAnalytics();
    expect(sdk.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "/ingest",
        advanced_disable_flags: true,
        disable_surveys: true,
        disable_session_recording: true,
      }),
    );
    // Already on by default once started, so no `$opt_in` event on every page load.
    expect(sdk.opt_in_capturing).not.toHaveBeenCalled();
    track("x", { a: 1 });
    expect(sdk.capture).toHaveBeenCalledWith("x", { a: 1 });
  });

  it("opts back in after an earlier withdrawal, which the SDK remembers across page loads", async () => {
    setConsent(true);
    sdk.has_opted_in_capturing.mockReturnValue(false);
    const { startAnalytics } = await load();
    startAnalytics();
    expect(sdk.opt_in_capturing).toHaveBeenCalledOnce();
  });

  it("does nothing, and every call site stays safe, when there is no token", async () => {
    setConsent(true);
    const { startAnalytics, saveConsent, track, identifyUser, captureError } = await load(null);
    startAnalytics();
    saveConsent(true);
    track("x");
    identifyUser("u1");
    captureError(new Error("boom"));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.identify).not.toHaveBeenCalled();
  });
});

describe("choosing", () => {
  it("accepting starts PostHog and identifies the person already signed in", async () => {
    const { startAnalytics, identifyUser, saveConsent } = await load();
    startAnalytics();
    identifyUser("u1");
    // Not yet: they have not said yes, so nobody is identified to PostHog.
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.identify).not.toHaveBeenCalled();

    saveConsent(true);
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.identify).toHaveBeenCalledWith("u1");
  });

  it("withdrawing turns capture off", async () => {
    const { startAnalytics, saveConsent } = await load();
    startAnalytics();
    saveConsent(true);
    saveConsent(false);
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
  });

  it("withdrawing deletes the ids PostHog stored, but keeps its own record of the refusal", async () => {
    localStorage.setItem("ph_phc_test_posthog", '{"distinct_id":"x"}');
    localStorage.setItem("__ph_opt_in_out_phc_test", "0");
    localStorage.setItem("unrelated", "keep");
    const { startAnalytics, saveConsent } = await load();
    startAnalytics();
    saveConsent(true);
    saveConsent(false);
    expect(localStorage.getItem("ph_phc_test_posthog")).toBeNull();
    expect(localStorage.getItem("__ph_opt_in_out_phc_test")).toBe("0");
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("declining without ever having accepted does not touch the SDK", async () => {
    const { startAnalytics, saveConsent } = await load();
    startAnalytics();
    saveConsent(false);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("tells a listener what was chosen", async () => {
    const { startAnalytics, saveConsent, onConsentChange } = await load();
    startAnalytics();
    const listener = vi.fn();
    const stop = onConsentChange(listener);
    saveConsent(true);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ analytics: true }));
    stop();
    saveConsent(false);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("identifying", () => {
  it("sends the id and nothing else", async () => {
    setConsent(true);
    const { startAnalytics, identifyUser } = await load();
    startAnalytics();
    identifyUser("u1");
    expect(sdk.identify).toHaveBeenCalledWith("u1");
  });

  it("does not mint a new anonymous id for a visitor who was never signed in", async () => {
    setConsent(true);
    const { startAnalytics, identifyUser } = await load();
    startAnalytics();
    identifyUser(null);
    expect(sdk.reset).not.toHaveBeenCalled();
  });

  it("resets on logout and then puts consent back, because reset() clears it", async () => {
    setConsent(true);
    const { startAnalytics, identifyUser } = await load();
    startAnalytics();
    identifyUser("u1");
    // reset() wipes the SDK's consent record, which reads as "not opted in".
    sdk.reset.mockImplementation(() => sdk.has_opted_in_capturing.mockReturnValue(false));

    identifyUser(null);
    expect(sdk.reset).toHaveBeenCalledOnce();
    // Order matters: opting in before reset() would be undone by it.
    expect(sdk.reset.mock.invocationCallOrder[0]).toBeLessThan(sdk.opt_in_capturing.mock.invocationCallOrder[0]!);
  });

  it("does not let a logout switch capture back on for someone who withdrew", async () => {
    const { startAnalytics, identifyUser, saveConsent } = await load();
    startAnalytics();
    identifyUser("u1");
    saveConsent(true);
    saveConsent(false);
    sdk.opt_out_capturing.mockClear();
    // reset() returns the SDK to its default, which is "on".
    sdk.reset.mockImplementation(() => sdk.has_opted_in_capturing.mockReturnValue(true));

    identifyUser(null);
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
  });
});
