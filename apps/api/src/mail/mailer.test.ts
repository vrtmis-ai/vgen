import { describe, expect, it } from "vitest";
import { smtpSettingsFromEnv } from "./mailer";
import { inviteEmail } from "./inviteEmail";

/**
 * All five settings or none.
 *
 * A half-configured transport fails on the first send, which is the worst
 * moment to find out: an operator has pressed a button, some of the queue has
 * been marked invited, and the rest has not.
 */
describe("reading SMTP settings from the environment", () => {
  const full = {
    SMTP_HOST: "mail.deevapp.com",
    SMTP_USER: "info@deevapp.com",
    SMTP_PASSWORD: "not-a-real-password",
    MAIL_FROM: "DEEV <info@deevapp.com>",
  };

  it("defaults to the submission port, which is the one that takes a password", () => {
    expect(smtpSettingsFromEnv(full as NodeJS.ProcessEnv)).toMatchObject({ port: 587, host: "mail.deevapp.com" });
  });

  it("names the sender after the mailbox when nothing else says", () => {
    const { MAIL_FROM: _unused, ...withoutFrom } = full;
    expect(smtpSettingsFromEnv(withoutFrom as NodeJS.ProcessEnv)?.from).toBe("DEEV <info@deevapp.com>");
  });

  it("returns nothing at all when any one of them is missing", () => {
    for (const missing of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"] as const) {
      const partial = { ...full, [missing]: "" };
      expect(smtpSettingsFromEnv(partial as NodeJS.ProcessEnv)).toBeNull();
    }
    expect(smtpSettingsFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("the invite mail", () => {
  it("carries the code as text as well as a link", () => {
    const mail = inviteEmail("DEEV-ABC123", "https://deevapp.com");

    // Both, because a link rewritten by a mail client or opened on another
    // device still leaves something the person can type.
    expect(mail.text).toContain("DEEV-ABC123");
    expect(mail.text).toContain("https://deevapp.com/signup?invite=DEEV-ABC123");
    expect(mail.html).toContain("DEEV-ABC123");
    expect(mail.html).toContain("https://deevapp.com/signup?invite=DEEV-ABC123");
  });

  it("has a plain-text part that stands on its own", () => {
    // A message with no text part scores worse with spam filters, and this
    // domain has no sending reputation to spend.
    const mail = inviteEmail("DEEV-XYZ789", "https://deevapp.com");
    expect(mail.text.length).toBeGreaterThan(80);
    expect(mail.text).not.toContain("<");
  });

  it("escapes what it puts in the markup", () => {
    const mail = inviteEmail('a"><script>alert(1)</script>', "https://deevapp.com");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("does not leave a double slash in the link when the origin has a trailing one", () => {
    expect(inviteEmail("CODE", "https://deevapp.com/").text).toContain("https://deevapp.com/signup?invite=CODE");
  });
});
