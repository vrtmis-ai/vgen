import { emailButton, emailCallout, emailShell, linkTo } from "./layout";

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
  const link = `${linkTo(webOrigin, "/signup?invite=")}${encodeURIComponent(code)}`;

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

  const html = emailShell({
    heading: "نوبت تو رسید",
    lead: "کد دعوت تو برای ساخت حساب در DEEV آماده است.",
    blocks: [emailCallout("کد دعوت", code), emailButton(link, "ساخت حساب")],
    notes: ["این کد فقط برای یک حساب کار می‌کند و بعد از آن باطل می‌شود.", "اگر خودت در نوبت ثبت‌نام نکرده بودی، این نامه را نادیده بگیر."],
  });

  return { subject: "کد دعوت DEEV", text, html };
}
