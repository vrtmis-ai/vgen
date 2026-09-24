/**
 * Usernames: the public name for an account, unique across the site.
 *
 * `users.handle` has been a `citext UNIQUE` column since the first migration
 * and the community feed has always drawn `coalesce(handle, display_name)` —
 * but nothing ever wrote to it, so in production only the ten seeded demo
 * authors had one and every real customer showed up under an email-derived
 * display name or nothing at all.
 *
 * **Latin only**, deliberately, and not for want of Persian support elsewhere:
 * `ي` and `ی`, `ك` and `ک`, and the zero-width joiner all render the same or
 * nearly the same, so a Persian handle set is one where `فرشاد` and `فرشاد`
 * are different accounts with the same name on screen. That is an
 * impersonation surface, and the way to not have it is to not open it. Display
 * names stay free-form; this is the identifier.
 *
 * Two entry points, because they answer different questions:
 *
 *   · `normalizeHandle` — somebody typed this. Tidy the harmless differences
 *     (case, spaces, Persian digits) and then either accept it or refuse it.
 *     Never silently rewrite a name into a different one.
 *   · `mintHandle` — nobody typed anything. Make one up from whatever we know,
 *     and it has to succeed.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;

/** 3–24 characters; starts and ends on a letter or digit, so `.reza` and `reza_` are out. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/;

/**
 * Names the site needs for itself, or that would let somebody pass as staff.
 *
 * Route names are in here because `/profile/<handle>` is the obvious next page
 * and a handle of `settings` would collide with it. Cheaper to reserve the word
 * now than to rename somebody's account later.
 */
const RESERVED = new Set([
  "about",
  "academy",
  "admin",
  "administrator",
  "api",
  "coins",
  "community",
  "contact",
  "cookies",
  "deev",
  "deevapp",
  "effects",
  "explore",
  "gallery",
  "help",
  "login",
  "me",
  "mod",
  "moderator",
  "null",
  "official",
  "owner",
  "plans",
  "privacy",
  "profile",
  "root",
  "settings",
  "signup",
  "staff",
  "studio",
  "support",
  "system",
  "team",
  "terms",
  "undefined",
  "vgen",
  "www",
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}

/** Persian and Arabic digits to ASCII, so a Persian keyboard is not a refusal. */
function asciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * What somebody typed, or null if it is not a username.
 *
 * Case and surrounding space are tidied because nobody means them; anything
 * else that does not fit is refused rather than corrected, since a form that
 * quietly hands you a different name than the one you asked for is worse than
 * one that says no.
 */
export function normalizeHandle(raw: string): string | null {
  const handle = asciiDigits(raw.trim().toLowerCase());
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return null;
  if (!HANDLE_PATTERN.test(handle)) return null;
  if (isReservedHandle(handle)) return null;
  return handle;
}

/**
 * A handle from whatever we know about somebody — usually their email's local
 * part — for the accounts nobody asked. This one cannot fail: OAuth and the
 * phone code have no form to ask on, and `handle` is NOT NULL.
 *
 * `suffix` is for the second attempt after a unique violation. It goes on the
 * end and the base is trimmed to make room, so the result is always in range.
 */
export function mintHandle(seed: string, suffix = ""): string {
  const stripped = asciiDigits(seed.trim().toLowerCase())
    .replace(/[^a-z0-9._]/g, "")
    .replace(/^[._]+|[._]+$/g, "");

  const room = HANDLE_MAX - suffix.length;
  let base = stripped.slice(0, room).replace(/[._]+$/, "");
  // Too short, empty, or a word we keep: fall back rather than return
  // something that would fail its own validator.
  if (base.length + suffix.length < HANDLE_MIN || isReservedHandle(base + suffix)) {
    base = `user${base}`.slice(0, room);
  }
  const handle = base + suffix;
  return handle.length >= HANDLE_MIN ? handle : `user${handle}`.slice(0, HANDLE_MAX);
}
