import { describe, expect, it } from "vitest";
import { otherMethodEmail, resetEmail } from "./resetEmail";

/**
 * The mail is the whole flow for somebody who cannot sign in, so what is
 * checked here is what they actually receive: a link that works, a button
 * that looks like the site, and no reset link at all in the mail that says
 * there is no password to reset.
 */
describe("the reset mail", () => {
  it("carries the link in both halves of the message", () => {
    const { html, text, subject } = resetEmail("tok-en", "https://deevapp.com/");

    // Trailing slash folded; the token is the only way in, so the text part
    // carries the whole URL rather than something to retype.
    expect(html).toContain('href="https://deevapp.com/reset?token=tok-en"');
    expect(text).toContain("https://deevapp.com/reset?token=tok-en");
    expect(subject).toBeTruthy();
  });

  it("wears the site's button", () => {
    const { html } = resetEmail("tok-en", "https://deevapp.com");

    // The same dark pill with a lit lime edge the invite mail wears, from the
    // same helper — a lime slab with dark type would be the wrong button.
    expect(html).toContain('bgcolor="#c6f52e"');
    expect(html).toContain('bgcolor="#0a0c0d"');
  });

  it("escapes a token rather than pasting it into the markup", () => {
    // Tokens are base64url and cannot contain this, which is exactly when a
    // guard is cheap to keep.
    const { html } = resetEmail('x"><script>', "https://deevapp.com");

    expect(html).not.toContain("<script>");
  });

  it("sends an account with no password to sign in, with no reset link", () => {
    const google = otherMethodEmail("oauth", "https://deevapp.com");
    const phone = otherMethodEmail("phone", "https://deevapp.com");

    for (const mail of [google, phone]) {
      // There is no password to reset, so there must be no link pretending
      // otherwise — only the way they really sign in.
      expect(mail.html).not.toContain("/reset?token=");
      expect(mail.html).toContain('href="https://deevapp.com/signin"');
      expect(mail.text).toContain("https://deevapp.com/signin");
    }
    expect(google.text).toContain("گوگل");
    expect(phone.text).toContain("موبایل");
  });
});
