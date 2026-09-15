import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "../data/brand";

/* ---------------------------------------------------------------------------
   The shell every legal page shares.

   Five of them are required before a payment gateway will be issued, and an
   evaluator reads them in one sitting. Built as one object rather than five
   hand-made pages so they cannot drift into looking like five different
   companies wrote them — which is itself something reviewers notice.

   Server Components: there is nothing interactive on any of these, and a page
   of prose has no business shipping JavaScript.
   --------------------------------------------------------------------------- */

/**
 * A statement the owner has to make and the software cannot.
 *
 * Postal addresses, registration numbers and refund windows are facts about a
 * business, not about a program, and a plausible-looking invented one is worse
 * than a gap: it reads as true, it will be checked against the registration
 * documents, and it fails the review it was meant to pass.
 *
 * Rendered visibly rather than as an HTML comment, so it cannot be published
 * by accident.
 */
export function Blank({ children }: { children: ReactNode }) {
  return (
    <mark
      className="rounded px-1.5 py-0.5 text-[12.5px] font-semibold"
      style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)" }}
    >
      ⚠ {children}
    </mark>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-bold" style={{ color: "var(--vg-text)" }}>
        {title}
      </h2>
      <div className="mt-2 grid gap-2.5 text-[13px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: ReactNode;
  /** The date this text last changed, in Persian. Reviewers look for it. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-10">
      <Link href="/" className="text-[12.5px]" style={{ color: "var(--vg-text-faint)" }}>
        ← {BRAND.name}
      </Link>
      <h1 className="mt-4 text-[22px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        {title}
      </h1>
      <p className="mt-2 text-[13px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
        {intro}
      </p>
      {children}
      <p className="mt-10 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        آخرین بازبینی: {updated}
      </p>
    </main>
  );
}

/** The date the five pages were last reviewed together. One string, one edit. */
export const LEGAL_UPDATED = "۱۸ شهریور ۱۴۰۵";
