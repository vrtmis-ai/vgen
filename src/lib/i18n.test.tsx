import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { LanguageProvider, useI18n } from "./i18n";

/**
 * What the screens actually print.
 *
 * `format.test.ts` covers `coinDigits` on its own, and that is not the same
 * claim: the provider chooses the locale, and a version of it pinned to `en-US`
 * passed every test in this repo while the product showed `۱,۲۵۰` — a Persian
 * numeral holding an ASCII comma. These assert the pair together.
 */
function formatters(lang: "fa" | "en") {
  return renderHook(() => useI18n(), {
    wrapper: ({ children }: { children: ReactNode }) => <LanguageProvider initialLang={lang}>{children}</LanguageProvider>,
  }).result.current;
}

describe("the numbers a screen prints", () => {
  it("writes a Persian figure the way Persian writes it", () => {
    const { n, c } = formatters("fa");

    // U+066C between the thousands, U+066B before the fraction.
    expect(n(1250)).toBe("۱٬۲۵۰");
    expect(c(1250.5)).toBe("۱٬۲۵۰٫۵");
    expect(c(0.16)).toBe("۰٫۱۶");
  });

  it("never mixes Persian digits with English punctuation", () => {
    const { n, c } = formatters("fa");

    for (const figure of [n(1250), n(1234567), c(1250.5), c(0.16)]) {
      expect(figure).not.toContain(",");
      expect(figure).not.toContain(".");
    }
  });

  it("leaves English as English", () => {
    const { n, c } = formatters("en");

    expect(n(1250)).toBe("1,250");
    expect(c(1250.5)).toBe("1,250.5");
  });
});
