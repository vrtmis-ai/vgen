import { emailButton, emailShell, linkTo } from "./layout";

/**
 * The mail somebody gets when they have forgotten their password.
 *
 * **No code to type, unlike the invite.** A reset token is 32 random bytes and
 * nobody is going to copy it off a screen, so the link is the only way in and
 * the text half carries the whole URL rather than a short code.
 *
 * The two notes are the ones that matter to somebody reading this in a hurry:
 * how long they have, and what to do if they did not ask for it. The second is
 * not boilerplate — this mail is the one an attacker triggers at somebody
 * else's address, and the honest answer is that ignoring it costs nothing,
 * because the password only changes when the link is opened.
 */
export function resetEmail(token: string, webOrigin: string): { subject: string; text: string; html: string } {
  const link = `${linkTo(webOrigin, "/reset?token=")}${encodeURIComponent(token)}`;

  const text = [
    "رمز عبورت را عوض کن.",
    "",
    "برای گذاشتن رمز تازه این نشانی را باز کن:",
    `    ${link}`,
    "",
    "این پیوند یک ساعت کار می‌کند و فقط یک بار.",
    "اگر خودت درخواست نکرده بودی، این نامه را نادیده بگیر — رمزت عوض نمی‌شود.",
    "",
    "— DEEV",
  ].join("\n");

  const html = emailShell({
    heading: "رمز عبورت را عوض کن",
    lead: "برای حساب DEEV تو درخواست رمز تازه شده است. با دکمهٔ پایین رمز جدیدت را بگذار.",
    blocks: [emailButton(link, "گذاشتن رمز تازه")],
    notes: ["این پیوند یک ساعت کار می‌کند و فقط یک بار.", "اگر خودت درخواست نکرده بودی، این نامه را نادیده بگیر — رمزت عوض نمی‌شود."],
  });

  return { subject: "بازیابی رمز DEEV", text, html };
}

/**
 * The mail for an account that has no password to reset.
 *
 * Somebody who signs in with Google, or with a code sent to their phone, has
 * never had a password — so there is nothing to reset and no token is minted.
 * Saying so is kinder than silence and safer than quietly giving a
 * Google-only account a second way in that its owner never asked for.
 */
export function otherMethodEmail(method: "oauth" | "phone", webOrigin: string): { subject: string; text: string; html: string } {
  const link = linkTo(webOrigin, "/signin");
  const how = method === "oauth" ? "این حساب با گوگل وارد می‌شود." : "این حساب با شمارهٔ موبایل و کد پیامکی وارد می‌شود.";

  const text = [
    "رمزی برای عوض کردن نیست.",
    "",
    how,
    "برای همین رمز عبوری روی این حساب ساخته نشده و پیوند بازیابی هم فرستاده نشد.",
    "",
    "برای ورود این نشانی را باز کن:",
    `    ${link}`,
    "",
    "اگر خودت درخواست نکرده بودی، این نامه را نادیده بگیر.",
    "",
    "— DEEV",
  ].join("\n");

  const html = emailShell({
    heading: "رمزی برای عوض کردن نیست",
    lead: `${how} برای همین رمز عبوری روی این حساب ساخته نشده و پیوند بازیابی هم فرستاده نشد.`,
    blocks: [emailButton(link, "ورود به DEEV")],
    notes: ["اگر خودت درخواست نکرده بودی، این نامه را نادیده بگیر."],
  });

  return { subject: "ورود به DEEV", text, html };
}
