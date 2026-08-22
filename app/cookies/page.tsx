import type { Metadata } from "next";
import Link from "next/link";
import { COOKIES, type CookieCategory } from "../../src/lib/cookies";

export const metadata: Metadata = { title: "کوکی‌ها — DEEV" };

/**
 * The cookie policy.
 *
 * Generated from `COOKIES` rather than written out, so the page and the
 * software cannot drift apart. A policy maintained separately from the code is
 * a policy that is wrong the first time somebody adds a cookie and forgets the
 * document — which is most of the cookie policies on the internet.
 *
 * A Server Component: there is nothing interactive here and nothing worth
 * shipping to the browser for a page of static rows.
 */
const CATEGORY_LABEL: Record<CookieCategory, string> = {
  essential: "ضروری",
  analytics: "تحلیلی",
};

export default function CookiesPage() {
  const categories = [...new Set(COOKIES.map((cookie) => cookie.category))];

  return (
    <main className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-10">
      <h1 className="text-[22px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        کوکی‌ها
      </h1>
      <p className="mt-2 text-[13px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
        هر کوکی‌ای که این سایت می‌گذارد، اینجا فهرست شده است. این فهرست از همان جایی خوانده می‌شود که خودِ برنامه می‌خواند، پس نمی‌تواند با
        واقعیت اختلاف پیدا کند.
      </p>
      <p className="mt-2 text-[13px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
        در این لحظه <strong style={{ color: "var(--vg-text)" }}>همه‌ی کوکی‌های ما ضروری‌اند</strong>: برای واردماندن، زبان، و به‌خاطرسپردن
        پاسخ خودت به اعلان کوکی. هیچ ردیاب شخص‌ثالث، هیچ پیکسل تبلیغاتی و هیچ کوکی تحلیلی وجود ندارد. اگر روزی اضافه شود، پیش از روشن‌شدن از
        تو پرسیده می‌شود.
      </p>

      {categories.map((category) => (
        <section key={category} className="mt-8">
          <h2 className="text-[15px] font-bold" style={{ color: "var(--vg-text)" }}>
            {CATEGORY_LABEL[category]}
          </h2>
          {category === "essential" ? (
            <p className="mt-1 text-[12.5px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
              بدون این‌ها سایت کار نمی‌کند، و به همین دلیل قابل رد کردن نیستند — کوکی نشستی که رد شده باشد یعنی حسابی که نمی‌شود در آن وارد
              ماند.
            </p>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr style={{ color: "var(--vg-text-faint)" }}>
                  {["نام", "برای چه", "ماندگاری", "خواندنی با اسکریپت"].map((label) => (
                    <th key={label} className="pb-2 text-start font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COOKIES.filter((cookie) => cookie.category === category).map((cookie) => (
                  <tr key={cookie.name} className="border-t align-top" style={{ borderColor: "var(--vg-border-subtle)" }}>
                    <td className="py-2.5 pe-3" style={{ color: "var(--vg-text)" }}>
                      <code dir="ltr" className="text-[11.5px]">
                        {cookie.name}
                      </code>
                    </td>
                    <td className="py-2.5 pe-3 leading-6" style={{ color: "var(--vg-text-muted)" }}>
                      {cookie.purpose}
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap" style={{ color: "var(--vg-text-faint)" }}>
                      {cookie.lifetime}
                    </td>
                    <td className="py-2.5" style={{ color: "var(--vg-text-faint)" }}>
                      {/* HttpOnly is the one property here a visitor benefits from
                          knowing: it is why a session cookie cannot be stolen by a
                          script that gets onto the page. */}
                      {cookie.httpOnly ? "نه — HttpOnly" : "بله"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--vg-text)" }}>
          پاک‌کردنشان
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
          از تنظیمات مرورگرت می‌توانی هر وقت خواستی همه را پاک کنی. نتیجه‌اش این است که از حساب خارج می‌شوی و زبان به فارسی برمی‌گردد؛ چیز
          دیگری از دست نمی‌رود.
        </p>
      </section>

      <Link
        href="/"
        className="mt-10 inline-block text-[12.5px] underline-offset-2 hover:underline"
        style={{ color: "var(--vg-text-faint)" }}
      >
        ← برگشت
      </Link>
    </main>
  );
}
