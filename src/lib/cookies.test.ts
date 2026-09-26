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
      ["__ph_opt_in_out_*", "deev_admin", "deev_oauth_state", "deev_session", "ph_*_posthog", "vgen-lang", "vgen_consent"].sort(),
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

  it("offers exactly one thing to refuse: PostHog", () => {
    // The banner and the policy page both say "only PostHog is optional". If
    // another tracker is added, this fails and their copy has to change with it.
    const optional = COOKIES.filter((cookie) => cookie.category !== "essential");
    expect(optional.map((cookie) => cookie.name)).toEqual(["ph_*_posthog"]);
    expect(optional.every((cookie) => cookie.category === "analytics")).toBe(true);
  });

  it("re-asks everyone who only pressed OK on the old notice", () => {
    // v1 was an acknowledgement of a notice that offered nothing to refuse.
    const acknowledged = encodeURIComponent(JSON.stringify({ v: 1, analytics: false, at: Date.now() }));
    expect(parseConsent(acknowledged)).toBeNull();
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
