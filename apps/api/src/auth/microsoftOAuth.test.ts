import { describe, expect, it } from "vitest";
import { MicrosoftOAuth, emailIsVerified, readMicrosoftProfile } from "./microsoftOAuth";
import { OAuthError } from "./oidc";

/**
 * These are the account-takeover tests.
 *
 * `signInWithOAuth` links a new identity onto whichever user already holds the
 * address in the token. So "is this address verified?" is not a data-quality
 * question — a wrong `true` hands an attacker someone else's account and their
 * credit balance. Each case below is a way that answer could be got wrong.
 */
describe("whether a Microsoft address may be believed", () => {
  it("believes an explicit xms_edov, in either spelling Microsoft ships it as", () => {
    for (const value of [true, "true", "1"]) {
      expect(emailIsVerified({ xms_edov: value }, "common")).toBe(true);
    }
  });

  // The claim is authoritative in both directions. A tenant that says "no" must
  // not be overridden by the multi-tenant presence rule below.
  it("refuses an explicit negative xms_edov even under a multi-tenant registration", () => {
    for (const value of [false, "false", "0"]) {
      expect(emailIsVerified({ email: "person@example.com", xms_edov: value }, "common")).toBe(false);
    }
  });

  // Since June 2023 Microsoft omits unverified addresses from multi-tenant
  // tokens outright, so presence is the proof when the claim is absent.
  it("trusts presence alone for the multi-tenant audiences", () => {
    for (const tenant of ["common", "organizations", "consumers"]) {
      expect(emailIsVerified({ email: "person@example.com" }, tenant)).toBe(true);
    }
  });

  // Pinned to one organisation that guarantee does not apply, and the tenant
  // admin controls what the claim says. Without proof, assume nothing.
  it("does not trust presence alone when pinned to a single tenant", () => {
    expect(emailIsVerified({ email: "person@example.com" }, "6babcaad-604b-40ac-a9d7-9fd97c0b779f")).toBe(false);
    expect(emailIsVerified({ email: "person@example.com", xms_edov: true }, "6babcaad-604b-40ac-a9d7-9fd97c0b779f")).toBe(true);
  });
});

describe("reading a Microsoft profile", () => {
  it("keeps a verified address and lowercases it", () => {
    const profile = readMicrosoftProfile({ sub: "ms-1", email: "Person@Example.COM", name: "P" }, "common");

    expect(profile).toEqual({ subject: "ms-1", email: "person@example.com", emailVerified: true, displayName: "P" });
  });

  it("drops an address it cannot vouch for rather than passing it on", () => {
    const profile = readMicrosoftProfile({ sub: "ms-2", email: "victim@example.com", xms_edov: false }, "common");

    expect(profile.email).toBeNull();
    expect(profile.emailVerified).toBe(false);
    // The person still signs in — they are just not handed anyone else's account.
    expect(profile.subject).toBe("ms-2");
  });

  // preferred_username is mutable and is not guaranteed to be an address at
  // all. Using it to link accounts is the bug this asserts against.
  it("never falls back to preferred_username for the address", () => {
    const profile = readMicrosoftProfile({ sub: "ms-3", preferred_username: "victim@example.com" }, "common");

    expect(profile.email).toBeNull();
  });

  it("refuses an id_token that identifies nobody", () => {
    expect(() => readMicrosoftProfile({ email: "person@example.com" }, "common")).toThrow(OAuthError);
  });
});

describe("the Microsoft authorization URL", () => {
  const client = (tenant?: string) =>
    new MicrosoftOAuth({
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://api.deev.test/api/v1/auth/microsoft/callback",
      ...(tenant ? { tenant } : {}),
    });

  it("defaults to the common audience and asks for an account chooser", () => {
    const { url, state } = client().createAuthorizationUrl();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid email profile");
    expect(parsed.searchParams.get("prompt")).toBe("select_account");
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThan(16);
  });

  it("puts a configured tenant in the path", () => {
    const url = new URL(client("6babcaad-604b-40ac-a9d7-9fd97c0b779f").createAuthorizationUrl().url);

    expect(url.pathname).toBe("/6babcaad-604b-40ac-a9d7-9fd97c0b779f/oauth2/v2.0/authorize");
  });

  // Two sign-ins must not be able to share a CSRF token.
  it("issues a fresh state every time", () => {
    const one = client().createAuthorizationUrl().state;
    const two = client().createAuthorizationUrl().state;

    expect(one).not.toBe(two);
  });
});

describe("exchanging the code", () => {
  const idToken = (claims: Record<string, unknown>) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  const client = (response: { ok: boolean; body?: unknown }) =>
    new MicrosoftOAuth({
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://api.deev.test/api/v1/auth/microsoft/callback",
      fetchImpl: (async () => ({
        ok: response.ok,
        status: response.ok ? 200 : 401,
        json: async () => response.body,
      })) as unknown as typeof fetch,
    });

  it("returns the profile from the id_token", async () => {
    const profile = await client({
      ok: true,
      body: { id_token: idToken({ sub: "ms-9", email: "person@example.com", name: "Person" }) },
    }).exchangeCode("code-1");

    expect(profile).toEqual({ subject: "ms-9", email: "person@example.com", emailVerified: true, displayName: "Person" });
  });

  it("fails loudly when Microsoft rejects the exchange", async () => {
    await expect(client({ ok: false }).exchangeCode("code-1")).rejects.toBeInstanceOf(OAuthError);
  });

  it("fails when the response carries no id_token", async () => {
    await expect(client({ ok: true, body: { access_token: "at" } }).exchangeCode("code-1")).rejects.toBeInstanceOf(OAuthError);
  });
});
