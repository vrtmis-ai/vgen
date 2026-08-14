/* ---------------------------------------------------------------------------
   The brand, in one place.

   The name was written out in eight components — the wordmark twice, the
   academy heading twice, the MCP copy twice, the landing hero. Renaming meant
   finding all eight and hoping none hid in a Persian sentence where a search
   for the Latin string still matches but the surrounding grammar has to change
   too.

   The other half of a re-brand is the palette, and that lives in
   design-system/tokens.css under the block marked THE ONE KNOB. Between that
   line and this file, a new identity is two edits.
   --------------------------------------------------------------------------- */

export const BRAND = {
  /**
   * The wordmark, as written.
   *
   * Latin inside Persian text, so anywhere it lands mid-sentence it needs a
   * `bdi` around it — otherwise the bidi algorithm reorders the punctuation on
   * whichever side of it falls at a direction boundary.
   */
  name: "DEEV",
  /**
   * From the brand sheet. Deliberately English and deliberately not translated:
   * it is set as part of the logo lockup, in Latin caps under the wordmark, and
   * a Persian rendering would be a different mark rather than the same one.
   * Anywhere it appears it is `lang="en"` so a screen reader does not read it
   * with Persian phonetics.
   */
  tagline: "TECHNOLOGY WITH EMPATHY",
} as const;

/** "آکادمی DEEV" and friends — the name inside a Persian noun phrase. */
export const brandPhrase = (persianNoun: string) => `${persianNoun} ${BRAND.name}`;
