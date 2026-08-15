import { z } from "zod";

/**
 * Language primitives with no React and no "use client".
 *
 * These are split out of i18n.tsx because the root layout is a Server Component
 * and imports them: anything reached through a "use client" module arrives on
 * the server as a client reference, not a callable function, so `parseLang`
 * would throw the moment the layout tried to use it.
 */
export type Lang = "fa" | "en";

export const LANG_COOKIE = "vgen-lang";
export const LANG_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const LanguageSchema = z.enum(["fa", "en"]);

export function dirFor(lang: Lang): "rtl" | "ltr" {
  return lang === "fa" ? "rtl" : "ltr";
}

/** Validates a raw cookie value, falling back to Persian. */
export function parseLang(value: string | undefined): Lang {
  const parsed = LanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : "fa";
}
