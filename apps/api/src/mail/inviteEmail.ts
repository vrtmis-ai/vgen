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

  /* Inline styles and a table-free layout: mail clients drop <style> blocks
     and disagree about everything else. `dir="rtl"` on the body rather than on
     a wrapper, because Outlook ignores direction on a nested div. */
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
  <body dir="rtl" style="margin:0;padding:24px;background:#0b0b0c;color:#e9e9ea;font-family:Tahoma,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#ffffff;">نوبت تو رسید</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#b9b9bd;">
        کد دعوت تو برای ساخت حساب در DEEV آماده است.
      </p>
      <p style="margin:0 0 6px;font-size:12px;color:#8a8a90;">کد دعوت</p>
      <p dir="ltr" style="margin:0 0 20px;font-size:22px;font-weight:bold;letter-spacing:2px;color:#c8f04a;font-family:monospace;">
        ${escapeHtml(code)}
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#c8f04a;color:#10120a;font-size:14px;font-weight:bold;text-decoration:none;">
          ساخت حساب
        </a>
      </p>
      <p style="margin:0 0 6px;font-size:12px;line-height:1.9;color:#8a8a90;">
        این کد فقط برای یک حساب کار می‌کند و بعد از آن باطل می‌شود.
      </p>
      <p style="margin:0;font-size:12px;line-height:1.9;color:#8a8a90;">
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
