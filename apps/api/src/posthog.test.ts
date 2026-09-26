import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "../../../src/lib/cookies";
import { analyticsAllowed } from "./posthog";

/**
 * A server event needs the same yes the browser needs. Everything ambiguous is a
 * no — this is the half of the consent rule that a visitor cannot see.
 */

const request = (cookie?: string) => ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as FastifyRequest;
const consent = (v: number, analytics: boolean) => `vgen_consent=${encodeURIComponent(JSON.stringify({ v, analytics, at: 1 }))}`;

describe("analyticsAllowed", () => {
  it("allows a current yes", () => {
    expect(analyticsAllowed(request(consent(CONSENT_VERSION, true)))).toBe(true);
  });

  it("finds it among the other cookies", () => {
    expect(analyticsAllowed(request(`deev_session=abc; ${consent(CONSENT_VERSION, true)}; vgen-lang=fa`))).toBe(true);
  });

  it("refuses a no", () => {
    expect(analyticsAllowed(request(consent(CONSENT_VERSION, false)))).toBe(false);
  });

  it("refuses when nobody has answered", () => {
    expect(analyticsAllowed(request())).toBe(false);
    expect(analyticsAllowed(request("deev_session=abc"))).toBe(false);
  });

  it("refuses a yes recorded against an older notice", () => {
    expect(analyticsAllowed(request(consent(CONSENT_VERSION - 1, true)))).toBe(false);
  });

  it("refuses rubbish instead of throwing", () => {
    expect(analyticsAllowed(request("vgen_consent=not-json"))).toBe(false);
    expect(analyticsAllowed(request("vgen_consent=%E0%A4%A"))).toBe(false);
    expect(analyticsAllowed(request(`vgen_consent=${encodeURIComponent('{"v":2,"analytics":"yes"}')}`))).toBe(false);
  });

  it("agrees with the browser about which notice is current", () => {
    // The API keeps its own copy of the number (it cannot import the web app's
    // client code). If the two drift apart the server goes silent, not loud, so
    // this is the only place anyone would find out.
    expect(analyticsAllowed(request(consent(CONSENT_VERSION, true)))).toBe(true);
  });
});
