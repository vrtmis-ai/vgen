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
  name: "VGen",
} as const;

/** "آکادمی VGen" and friends — the name inside a Persian noun phrase. */
export const brandPhrase = (persianNoun: string) => `${persianNoun} ${BRAND.name}`;
