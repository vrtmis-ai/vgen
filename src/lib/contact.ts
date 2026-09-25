/* ---------------------------------------------------------------------------
   A way to be reached, from one field.

   The rule itself moved to `@vgen/core` when `POST /auth/waitlist` was written:
   the form and the route have to agree on what an Iranian mobile is, and two
   copies of that agreement is one copy too many. Re-exported from here so the
   screens keep importing it from the place they always did.
   --------------------------------------------------------------------------- */

export { readContact, type ContactKind } from "@vgen/core";
