import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, COOKIES, allows, parseConsent, serializeConsent } from "./cookies";

/**
 * The consent record, and the registry the policy page is generated from.
 *
 * The rule worth holding: **a category defaults to off until it has been
 * asked about.** Everything else here follows from that, including why the
 * stored value is versioned — a consent given before a category existed is not
 * consent to it.
 */

describe("the cookie registry", () => {
  it("documents every cookie the product actually sets", () => {
    // The policy page renders this array. A cookie added to the code and not to
    // this list is a policy that has quietly become untrue, so the names are
    // pinned rather than merely counted.
    expect(COOKIES.map((cookie) => cookie.name).sort()).toEqual(
      ["deev_admin", "deev_oauth_state", "deev_session", "vgen-lang", "vgen_consent"].sort(),
    );
  });

  it("marks the session cookies as unreadable by scripts", () => {
    const byName = Object.fromEntries(COOKIES.map((cookie) => [cookie.name, cookie]));
    // The one property a visitor materially benefits from: it is why a session
    // cookie cannot be walked off with by a script that gets onto the page.
    expect(byName.deev_session!.httpOnly).toBe(true);
    expect(byName.deev_admin!.httpOnly).toBe(true);
    expect(byName.deev_oauth_state!.httpOnly).toBe(true);
    // The language and the consent record are read by the page itself.
    expect(byName["vgen-lang"]!.httpOnly).toBe(false);
    expect(byName.vgen_consent!.httpOnly).toBe(false);
  });

  it("has nothing to refuse today, and says so by having no non-essential entry", () => {
    // There is no tracker, pixel or ad tag in this product. If that stops being
    // true, this test fails and the banner's copy has to change with it.
    expect(COOKIES.every((cookie) => cookie.category === "essential")).toBe(true);
  });
});

describe("recording a choice", () => {
  it("round-trips through the cookie value", () => {
    const stored = parseConsent(serializeConsent(true));
    expect(stored?.analytics).toBe(true);
    expect(stored?.v).toBe(CONSENT_VERSION);
    expect(stored?.at).toBeGreaterThan(0);
  });

  it("treats nothing, rubbish and half-written values as not asked yet", () => {
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent("not json")).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION })))).toBeNull();
  });

  it("re-asks when the stored version is older than the current one", () => {
    const old = encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION - 1, analytics: true, at: Date.now() }));
    // A yes given before a category existed is not a yes to that category.
    // Treating a stale version as absent is the only reading that stays true.
    expect(parseConsent(old)).toBeNull();
  });
});

describe("what a choice permits", () => {
  it("always allows essential, even with no answer at all", () => {
    // A session cookie the visitor refused would mean an account they cannot
    // stay signed in to, so it is not offered as a question.
    expect(allows(null, "essential")).toBe(true);
    expect(allows(parseConsent(serializeConsent(false)), "essential")).toBe(true);
  });

  it("refuses analytics until somebody has actually said yes", () => {
    expect(allows(null, "analytics")).toBe(false);
    expect(allows(parseConsent(serializeConsent(false)), "analytics")).toBe(false);
    expect(allows(parseConsent(serializeConsent(true)), "analytics")).toBe(true);
  });
});
