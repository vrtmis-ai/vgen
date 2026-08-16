const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** True when a cover URL points to a video (render as <video>, not <img>). */
export function isVideoUrl(u?: string): boolean {
  return !!u && /\.(mp4|webm)$/i.test(u);
}

/** Convert latin digits in a value to Persian digits. */
export function faNum(value: number | string): string {
  // The pattern only ever matches 0-9, so the lookup always hits; `?? d` is how
  // that is stated to the compiler without an assertion that would also hide a
  // real miss if FA_DIGITS were ever edited.
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/**
 * The inverse of `faNum`, for a value that has to go back to the server.
 *
 * A Persian keyboard produces ۰-۹ and an Arabic one ٠-٩, but `OtpCodeSchema` is
 * `/^\d{6}$/` and the auth bodies are `.strict()` — so a code typed in Persian
 * digits comes back `validation_failed`, on the one screen where the user has no
 * way to guess what is wrong with six digits they can see are correct.
 *
 * Phone numbers deliberately do NOT go through this. The server normalises those
 * itself, precisely so two spellings of one number cannot become two accounts
 * with two free trials; formatting them here would be the client quietly taking
 * over a decision that has to be made in one place.
 */
export function latinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
