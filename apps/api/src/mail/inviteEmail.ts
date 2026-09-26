/**
 * The mail somebody gets when their turn in the queue comes up.
 *
 * Both parts are built here rather than in the route, so the wording lives in
 * one place and can be read without reading the sending loop around it.
 *
 * **Plain text is not a courtesy copy.** A message with no text part scores
 * worse with spam filters than one with both, and this domain is starting from
 * no sending reputation at all — so the text half is written to stand on its
 * own, not stripped from the HTML.
 *
 * The code is spelled out in the body as well as linked. A link that has been
 * rewritten by a mail client, or opened on a different device from the one
 * the person reads mail on, still leaves them something they can type.
 */
export function inviteEmail(code: string, webOrigin: string): { subject: string; text: string; html: string } {
  const link = `${webOrigin.replace(/\/+$/, "")}/signup?invite=${encodeURIComponent(code)}`;

  const text = [
    "نوبت تو رسید.",
    "",
    "کد دعوت تو برای ساخت حساب در DEEV:",
    `    ${code}`,
    "",
    "برای شروع این نشانی را باز کن:",
    `    ${link}`,
    "",
    "این کد فقط برای یک حساب کار می‌کند و بعد از آن باطل می‌شود.",
    "اگر خودت در نوبت ثبت‌نام نکرده بودی، این نامه را نادیده بگیر.",
    "",
    "— DEEV",
  ].join("\n");

  /* The door, wearing the face it wears on the site.

     The sign-up button on deevapp.com is a dark pill with a lit lime edge, not
     a lime slab with dark type. What turns around that edge in a browser is a
     conic gradient on an animation, and a mail client has neither — so it is
     frozen at one angle, which is all a screenshot of it would show anyway.

     Nested tables, because Outlook renders with Word: padding and radius on an
     `<a>` are ignored there, so the padding belongs to a `<td>`. The lit edge
     is a 1px gradient cell with the dark fill sitting inside it, and the
     `bgcolor` behind that gradient is the same lime — so where the gradient is
     dropped the edge survives as a flat ring instead of vanishing.

     Colours are the design tokens rather than near-misses of them:
     `--vg-canvas` #0a0c0d, `--vg-primary` #c6f52e, `--vg-text` #f4f5f7,
     `--vg-text-muted` #9fa4ad, `--vg-text-faint` #8c919b. */
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:separate;">
        <tr>
          <td bgcolor="#c6f52e" style="padding:1px;border-radius:999px;background:#c6f52e;background-image:linear-gradient(100deg,rgba(198,245,46,0.35),#c6f52e 38%,#eaffb0 50%,#c6f52e 62%,rgba(198,245,46,0.3));box-shadow:0 0 44px rgba(198,245,46,0.24);">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
              <tr>
                <td align="center" bgcolor="#0a0c0d" style="border-radius:999px;background:#0a0c0d;">
                  <a href="${escapeHtml(link)}" style="display:block;padding:14px 22px;border-radius:999px;color:#f4f5f7;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;">
                    ساخت حساب
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;

  /* Inline styles: mail clients drop `<style>` blocks. `dir="rtl"` on the body
     rather than on a wrapper, because Outlook ignores direction on a nested
     div. */
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
  <body dir="rtl" style="margin:0;padding:24px;background:#0a0c0d;color:#f4f5f7;font-family:Tahoma,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#f4f5f7;">نوبت تو رسید</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#9fa4ad;">
        کد دعوت تو برای ساخت حساب در DEEV آماده است.
      </p>
      <p style="margin:0 0 6px;font-size:12px;color:#8c919b;">کد دعوت</p>
      <p dir="ltr" style="margin:0 0 20px;font-size:22px;font-weight:bold;letter-spacing:2px;color:#c6f52e;font-family:monospace;">
        ${escapeHtml(code)}
      </p>
      ${button}
      <p style="margin:0 0 6px;font-size:12px;line-height:1.9;color:#8c919b;">
        این کد فقط برای یک حساب کار می‌کند و بعد از آن باطل می‌شود.
      </p>
      <p style="margin:0;font-size:12px;line-height:1.9;color:#8c919b;">
        اگر خودت در نوبت ثبت‌نام نکرده بودی، این نامه را نادیده بگیر.
      </p>
    </div>
  </body>
</html>`;

  return { subject: "کد دعوت DEEV", text, html };
}

/** The code is ours and the link is built here, but neither is a reason to
    interpolate unescaped into markup. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
