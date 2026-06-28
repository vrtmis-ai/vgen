const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Convert latin digits in a value to Persian digits. */
export function faNum(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}
