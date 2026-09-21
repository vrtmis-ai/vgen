/* ---------------------------------------------------------------------------
   Matching Persian text the way a person reads it, not the way it was typed.

   A blocklist that compares raw strings is defeated by a keyboard. The same
   Persian word arrives as five different byte sequences depending on whether
   the writer used an Iranian layout, an Arabic one, a phone, or a paste from a
   PDF: ک and ك are different codepoints, so are ی and ي and ى, half-spaces are
   invisible, digits come in three scripts, and Word helpfully inserts tatweel
   to justify a line.

   Fold both sides through here and those differences stop existing. The rules
   are stored already folded — see 0029 — so the comparison at request time is a
   plain substring scan and the two sides cannot drift apart.

   What this deliberately does NOT do is fold letters that carry meaning: ه and
   ة stay distinct, and so do the various hamza forms. Over-folding turns a
   blocklist into a censor of innocent words, which is worse than the leak it
   prevents.
   --------------------------------------------------------------------------- */

/** Letters that are the same letter, written on a different keyboard. */
const UNIFY: ReadonlyMap<string, string> = new Map([
  ["ك", "ک"], // ARABIC KAF        -> KEHEH        ك -> ک
  ["ي", "ی"], // ARABIC YEH        -> FARSI YEH    ي -> ی
  ["ى", "ی"], // ALEF MAKSURA      -> FARSI YEH    ى -> ی
  ["ە", "ه"], // AE                -> HEH          ە -> ه
  ["أ", "ا"], // ALEF WITH HAMZA   -> ALEF         أ -> ا
  ["إ", "ا"], // ALEF WITH HAMZA   -> ALEF         إ -> ا
  ["آ", "ا"], // ALEF WITH MADDA   -> ALEF         آ -> ا
]);

/**
 * Marks that are not letters and change nothing about the word.
 *
 * ZWNJ is the half-space: "می‌رود" and "میرود" are one word typed two ways.
 * Tatweel is a stretching character with no phonetic value at all. The
 * harakat are optional vowel marks, present in Quranic text and in almost
 * nothing else.
 */
const INVISIBLE =
  // By Unicode property rather than by hand-listed range, which is both more
  // honest about the intent and what stops eslint's
  // no-misleading-character-class from being right about it.
  //
  //   Cf  format characters: ZWNJ, ZWJ, the bidi marks and overrides, the BOM.
  //       ZWNJ is the half-space, so "می‌رود" and "میرود" are one word.
  //   Mn  non-spacing marks: the harakat and the superscript alef, which are
  //       optional vowel signs and appear in Quranic text and almost nowhere
  //       else.
  //   \u0640 tatweel, which is a letter by category and a stretching mark in
  //       practice. Word inserts it to justify a line.
  /[\p{Cf}\p{Mn}\u0640]/gu;

/** Arabic-Indic and Extended Arabic-Indic digits, in that order from zero. */
const DIGITS: ReadonlyMap<string, string> = new Map([..."٠١٢٣٤٥٦٧٨٩", ..."۰۱۲۳۴۵۶۷۸۹"].map((digit, index) => [digit, String(index % 10)]));

/**
 * One string, in the one form both sides of a comparison agree on.
 *
 * NFKC first, which collapses the Arabic presentation forms a PDF paste
 * carries; then the letter pairs, the invisibles, the digits, and finally
 * whitespace, so "two  words" and "two words" are one thing.
 */
export function foldForMatching(text: string): string {
  const folded = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/./gu, (character) => UNIFY.get(character) ?? DIGITS.get(character) ?? character);
  return folded.replace(/\s+/gu, " ").trim();
}

/** A phrase a prompt may not contain, as the guard holds it. */
export interface PromptRule {
  id: string;
  phrase: string;
  /** Already folded. Compared against a folded prompt, never against a raw one. */
  needle: string;
  category: string;
  reason: string | null;
}

export interface PromptMatch {
  rule: PromptRule;
  /** The folded prompt, so a caller logging the refusal need not fold it twice. */
  folded: string;
}

/**
 * The first rule this prompt breaks, or null.
 *
 * First rather than all of them: the person is told one reason and the log
 * records one rule, because a refusal listing every phrase it matched is a map
 * of the blocklist. Rules are scanned in the order given, so a caller that
 * wants the most serious answer first sorts them that way.
 *
 * An empty rule set means no prompt is ever refused, which is the correct
 * behaviour for a platform whose owner has not yet written the list — and is
 * why this is a no-op rather than a default-deny on day one.
 */
export function firstBrokenRule(prompt: string, rules: readonly PromptRule[]): PromptMatch | null {
  if (rules.length === 0) return null;
  const folded = foldForMatching(prompt);
  if (folded === "") return null;
  for (const rule of rules) {
    if (rule.needle !== "" && folded.includes(rule.needle)) return { rule, folded };
  }
  return null;
}
