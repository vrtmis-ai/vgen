const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** True when a cover URL points to a video (render as <video>, not <img>). */
export function isVideoUrl(u?: string): boolean {
  return !!u && /\.(mp4|webm)$/i.test(u);
}

/** Convert latin digits in a value to Persian digits. */
export function faNum(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}
