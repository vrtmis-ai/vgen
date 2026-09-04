const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/**
 * True when a cover URL points to a video (render as <video>, not <img>).
 *
 * The extension may be followed by a query or a fragment. Anchoring this at the
 * end of the string worked for catalogue covers, which are plain URLs, and
 * silently failed for anything signed — an S3 URL ends in its signature, so a
 * real generated clip read as "not a video" and went to an `<img>`. Callers
 * that hold a catalogue `kind` should prefer it; this is for the ones that only
 * ever have a URL.
 */
export function isVideoUrl(u?: string): boolean {
  return !!u && /\.(mp4|webm)(?:[?#]|$)/i.test(u);
}

/**
 * The locale a figure is formatted in.
 *
 * Persian is `fa-IR` and not "English grouping with the digits swapped
 * afterwards", which is what this file used to do. That produced `۱,۲۵۰` —
 * Persian numerals holding an ASCII comma — a spelling no Persian reader
 * writes. ICU knows the separator is `٬` and the decimal `٫`, and gives both in
 * the same step that gives the digits.
 */
export type NumberLocale = "fa-IR" | "en-US";

/**
 * Convert latin digits in a value to Persian digits.
 *
 * Still needed for strings that are not numbers ICU can format — a phone number
 * typed into a field, a code, an id. For an actual quantity prefer passing the
 * locale to `coinDigits` or `toLocaleString`, which also gets the separators
 * right.
 */
export function faNum(value: number | string): string {
  // The pattern only ever matches 0-9, so the lookup always hits; `?? d` is how
  // that is stated to the compiler without an assertion that would also hide a
  // real miss if FA_DIGITS were ever edited.
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/**
 * A coin amount, formatted for display.
 *
 * Coins stopped being whole numbers when billing moved to hundredths: the
 * cheapest models cost 0.10 or 0.16 of a coin, and rounding those up to 1 was
 * charging ten times the price. A wallet can therefore hold 0.9 of a coin, and
 * a screen that prints it as an integer either says "0" — pushing someone to
 * top up when they need not — or "1", which is money the account does not have.
 *
 * Two decimals, never three: a hundredth is the billing step, so a third digit
 * could only ever be float noise from a division. Trailing zeros are dropped
 * because whole coins are still the common case and "1,250.00" is noise.
 */
export function coinDigits(value: number, locale: NumberLocale = "en-US"): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

/**
 * Paragraph direction for a prompt field that takes either language.
 *
 * These fields hold both: the UI is Persian, the models answer best in English,
 * and the hint on the create screen says so. A fixed direction is wrong for one
 * of them — forced `ltr` laid a Persian prompt against the far edge of the box
 * from where its writer reads, and plain inherited `rtl` throws an English
 * sentence's full stop to the front.
 *
 * `dir="auto"` solves the typed case by reading the first strong character —
 * but only of the *value*. An empty field has no strong character, so `auto`
 * falls back to LTR and lays the Persian *placeholder* out left-to-right, which
 * moves its full stop to the wrong end. Undefined while empty lets the field
 * inherit the page's RTL and the placeholder reads correctly; the moment there
 * is content, `auto` follows the content.
 */
export function promptDir(value: string): "auto" | undefined {
  return value.trim() ? "auto" : undefined;
}
