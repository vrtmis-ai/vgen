import { describe, expect, it } from "vitest";
import { firstBrokenRule, foldForMatching, type PromptRule } from "./promptPolicy";

/* ---------------------------------------------------------------------------
   The guard is only worth the folding underneath it.

   A blocklist that compares raw strings is defeated by a keyboard, and the ways
   it is defeated are not obscure — they are what happens when somebody types
   the same word on an Arabic layout, pastes from a PDF, or lets Word justify a
   line. Every case below is a real spelling of a real word, not an attack.

   These tests are also where the false-positive bound lives: folding that goes
   one step too far turns a blocklist into a censor of innocent text, so the
   letters that carry meaning are asserted to survive.
   --------------------------------------------------------------------------- */

const rule = (needle: string): PromptRule => ({
  id: "rule-1",
  phrase: needle,
  needle: foldForMatching(needle),
  category: "test",
  reason: null,
});

describe("folding Persian for comparison", () => {
  it("treats the Arabic and Persian forms of a letter as the same letter", () => {
    // The two keyboards a customer might be using. Same word, different bytes.
    expect(foldForMatching("كيك")).toBe(foldForMatching("کیک"));
    expect(foldForMatching("علي")).toBe(foldForMatching("علی"));
  });

  it("ignores the half-space", () => {
    // "می‌رود" and "میرود" are one word typed two ways, and a ZWNJ between the
    // letters of a blocked phrase is the cheapest evasion there is.
    expect(foldForMatching("می‌رود")).toBe(foldForMatching("میرود"));
  });

  it("ignores tatweel, which Word inserts to justify a line", () => {
    expect(foldForMatching("کــیــک")).toBe(foldForMatching("کیک"));
  });

  it("ignores optional vowel marks", () => {
    expect(foldForMatching("کَیْک")).toBe(foldForMatching("کیک"));
  });

  it("reads all three sets of digits as the same number", () => {
    expect(foldForMatching("۱۲۳")).toBe("123");
    expect(foldForMatching("١٢٣")).toBe("123");
  });

  it("folds case and collapses runs of whitespace", () => {
    expect(foldForMatching("  Two   Words  ")).toBe("two words");
  });

  it("strips bidi overrides, which are invisible and reorder what is displayed", () => {
    expect(foldForMatching("ab‮cd")).toBe("abcd");
  });

  /* The other half of the bargain. Folding ه into ة, or ژ into ز, would make
     the list match words nobody meant to block — and a refusal a person cannot
     predict is indistinguishable from the product being broken. */
  it("keeps letters that are actually different letters", () => {
    expect(foldForMatching("ژاله")).not.toBe(foldForMatching("زاله"));
    expect(foldForMatching("گل")).not.toBe(foldForMatching("کل"));
  });
});

describe("finding the rule a prompt breaks", () => {
  it("refuses nothing when the list is empty", () => {
    // The day-one state, and the correct one: the mechanism ships before the
    // list does, and a list guessed at by a program is nobody's policy.
    expect(firstBrokenRule("anything at all", [])).toBeNull();
  });

  it("matches a phrase however it was spelled", () => {
    const rules = [rule("کیک")];
    // Arabic kaf, Arabic yeh, and a half-space wedged in the middle.
    expect(firstBrokenRule("یک كي‌ك بساز", rules)?.rule.needle).toBe("کیک");
  });

  it("leaves an unrelated prompt alone", () => {
    expect(firstBrokenRule("a lighthouse at dawn", [rule("کیک")])).toBeNull();
  });

  it("answers with the first rule and not with every rule", () => {
    // A refusal that lists everything it matched is a readable map of the
    // blocklist, which is a document we do not hand out.
    const rules = [rule("alpha"), rule("beta")];
    const match = firstBrokenRule("alpha and beta", rules);
    expect(match?.rule.needle).toBe("alpha");
  });

  it("hands back the folded prompt so the caller does not fold it twice", () => {
    expect(firstBrokenRule("  ALPHA  ", [rule("alpha")])?.folded).toBe("alpha");
  });

  it("passes a prompt that is only whitespace", () => {
    expect(firstBrokenRule("   ", [rule("alpha")])).toBeNull();
  });
});
