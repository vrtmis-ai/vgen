import { z } from "zod";

/**
 * Every cookie this product sets, in one place.
 *
 * The banner and the policy page both read this array, which is the only
 * property that matters here: a cookie policy is a statement about what the
 * software does, and a policy maintained separately from the software is a
 * statement that goes stale the first time somebody adds a cookie. Adding one
 * without adding it here should feel like the omission it is.
 *
 * No React and no "use client", because the policy page is a Server Component
 * and the banner is not — anything reached through a client module arrives on
 * the server as a reference rather than a value.
 *
 * **Everything here is strictly necessary except the analytics entry**, which
 * belongs to PostHog and is off until the visitor says yes. `analytics.ts`
 * does not even start the SDK until this says yes, and the API refuses to send
 * an event unless this same cookie says yes, so a refusal holds on both sides.
 */

export type CookieCategory = "essential" | "analytics";

export interface CookieRecord {
  name: string;
  category: CookieCategory;
  /** What it is for, in the words a visitor would use. */
  purpose: string;
  lifetime: string;
  /** Whether the browser's own scripts can read it. */
  httpOnly: boolean;
}

export const COOKIES: CookieRecord[] = [
  {
    name: "deev_session",
    category: "essential",
    purpose: "نگه‌داشتن حساب واردشده. بدون این، هر بار باید دوباره وارد شوی.",
    lifetime: "۳۰ روز",
    httpOnly: true,
  },
  {
    name: "deev_admin",
    category: "essential",
    purpose: "نشست کارکنان. جدا از نشست مشتری، تا دزدیده‌شدن یکی هرگز به‌معنای دیگری نباشد.",
    lifetime: "۱۲ ساعت",
    httpOnly: true,
  },
  {
    name: "deev_oauth_state",
    category: "essential",
    purpose: "جلوگیری از جعل درخواست هنگام ورود با گوگل. فقط تا پایان همان ورود زنده است.",
    lifetime: "۱۰ دقیقه",
    httpOnly: true,
  },
  {
    name: "vgen-lang",
    category: "essential",
    purpose: "زبان انتخابی، تا صفحه از همان اولین بایت درست و راست‌به‌چپ بیاید.",
    lifetime: "۱ سال",
    httpOnly: false,
  },
  {
    name: "vgen_consent",
    category: "essential",
    // The record of a refusal cannot itself be refusable, or the only way to
    // remember "no" is to ask again on every page.
    purpose: "پاسخ خودت به همین اعلان. بدون آن، این پیام در هر بازدید دوباره می‌آید.",
    lifetime: "۱ سال",
    httpOnly: false,
  },
  {
    // PostHog names it after the project token, hence the wildcard. It lives in
    // localStorage, not a cookie, which is why the purpose says "ذخیره‌سازی".
    name: "ph_*_posthog",
    category: "analytics",
    purpose:
      "ذخیره‌سازی شناسه‌ی ناشناس بازدید برای آمار استفاده (PostHog، سرورهای اروپا): کدام صفحه‌ها دیده می‌شوند و کجا گیج می‌شوی. فقط اگر بپذیری ساخته می‌شود و با پس‌گرفتن اجازه پاک می‌شود.",
    lifetime: "تا پس‌گرفتن اجازه",
    httpOnly: false,
  },
  {
    // Written only when somebody refuses after having accepted. Essential for the
    // same reason vgen_consent is: the record of a "no" cannot itself be refusable.
    name: "__ph_opt_in_out_*",
    category: "essential",
    purpose: "یادداشت خودِ PostHog که اجازه را پس گرفته‌ای، تا در همین صفحه دوباره روشن نشود. فقط بعد از پس‌گرفتن اجازه ساخته می‌شود.",
    lifetime: "تا پاک‌کردن مرورگر",
    httpOnly: false,
  },
];

export const CONSENT_COOKIE = "vgen_consent";
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * A recorded choice.
 *
 * Versioned so that adding a category later does not silently inherit a
 * consent nobody gave for it: a stored `v` below the current one is treated as
 * absent and asked again, which is the only reading that stays truthful.
 */
export const CONSENT_VERSION = 2;
// v1 was "باشه" on a notice that offered nothing to refuse, so it says nothing
// about analytics. apps/api/src/posthog.ts mirrors this number; if the two ever
// differ it fails closed (no server events), never open.

const ConsentSchema = z.object({
  v: z.number().int(),
  analytics: z.boolean(),
  /** When they chose, so an old consent can be re-asked if the law or the list changes. */
  at: z.number().int().nonnegative(),
});

export type Consent = z.infer<typeof ConsentSchema>;

/** Parses a stored value, treating anything unreadable or stale as "not asked yet". */
export function parseConsent(value: string | undefined): Consent | null {
  if (!value) return null;
  try {
    const parsed = ConsentSchema.safeParse(JSON.parse(decodeURIComponent(value)));
    if (!parsed.success) return null;
    return parsed.data.v === CONSENT_VERSION ? parsed.data : null;
  } catch {
    return null;
  }
}

export const serializeConsent = (analytics: boolean): string =>
  encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION, analytics, at: Date.now() } satisfies Consent));

/**
 * Is a category allowed to run right now?
 *
 * Essential is always true and is not a question — a session cookie the visitor
 * refused would mean an account they cannot stay signed in to. Everything else
 * defaults to **false until asked**, so a tracker added tomorrow is off for
 * everyone who has not since been asked, rather than on for everyone who was
 * asked before it existed.
 */
export function allows(consent: Consent | null, category: CookieCategory): boolean {
  if (category === "essential") return true;
  return consent?.analytics === true;
}
