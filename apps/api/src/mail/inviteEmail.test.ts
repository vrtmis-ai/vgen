import { describe, expect, it } from "vitest";
import { inviteEmail } from "./inviteEmail";

/**
 * The mail is markup, and markup in a mail client is not markup in a browser:
 * what is checked here is the handful of things that actually decide whether
 * the message arrives looking like DEEV or like a form letter.
 */
describe("the invite mail", () => {
  it("links the button at the sign-up page with the code already in it", () => {
    const { html, text } = inviteEmail("ABC123", "https://deevapp.com/");

    // Trailing slash folded, code escaped into the query — this link is the
    // whole point of the mail and the only thing most people will click.
    expect(html).toContain('href="https://deevapp.com/signup?invite=ABC123"');
    expect(text).toContain("https://deevapp.com/signup?invite=ABC123");
  });

  it("wears the site's button, not a lime slab", () => {
    const { html } = inviteEmail("ABC123", "https://deevapp.com");

    /* The sign-up button on the site is a dark pill with a lit lime edge. Get
       this backwards — lime fill, dark type — and the mail stops looking like
       the page it leads to. The `bgcolor` attributes are what Outlook reads,
       so they are the ones asserted. */
    expect(html).toContain('bgcolor="#c6f52e"'); // the lit edge
    expect(html).toContain('bgcolor="#0a0c0d"'); // the fill inside it
    expect(html).toContain("color:#f4f5f7"); // the label on top
  });

  it("escapes a code rather than pasting it into the markup", () => {
    // Codes are ours and this cannot happen today, which is exactly when a
    // guard is cheap. It is a link and a heading away from being a hole.
    const { html } = inviteEmail('X"><script>', "https://deevapp.com");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
