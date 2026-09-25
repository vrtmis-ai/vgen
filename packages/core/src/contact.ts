/* ---------------------------------------------------------------------------
   A way to be reached, from one field.

   The waitlist asks for one thing, not two — a second radio group to choose
   between an email and a phone is a question the value answers by itself. So
   the field takes either and this works out which arrived.

   **One implementation, both sides.** This lived in the browser alone while the
   route it posts to did not exist; now that it does, the form and the server
   have to agree on what a mobile number is, or a value the page accepts is a
   value the queue refuses. The browser bundle already reaches into this package
   for pricing, so there is no second copy to keep in step — unlike the zod
   contracts, which genuinely are mirrored.

   The server remains the authority. This is what lets the form refuse an empty
   box and a stray word before making a request, and lets it say which kind it
   thinks it has.
   --------------------------------------------------------------------------- */

export type ContactKind = "email" | "phone";

/**
 * Iranian mobile numbers, in the four shapes people actually type them:
 * `09121234567`, `9121234567`, `+989121234567`, `00989121234567`. Normalised
 * to the `09…` form, which is what every other phone field in this product
 * sends.
 */
function iranianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "00");
  const body = digits.startsWith("0098") ? digits.slice(4) : digits.startsWith("098") ? digits.slice(3) : digits;
  const local = body.startsWith("0") ? body.slice(1) : body;
  return /^9\d{9}$/.test(local) ? `0${local}` : null;
}

/**
 * Deliberately loose. A regular expression is not the arbiter of what a real
 * address is — the only test that settles it is sending something to it — so
 * this rejects what is obviously not one and lets the server decide the rest.
 */
function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(raw);
}

export function readContact(raw: string): { kind: ContactKind; value: string } | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const phone = iranianMobile(trimmed);
  if (phone) return { kind: "phone", value: phone };
  if (looksLikeEmail(trimmed)) return { kind: "email", value: trimmed };
  return null;
}
