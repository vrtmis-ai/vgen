import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalPage, LEGAL_UPDATED, Section } from "../../src/components/LegalPage";
import { BRAND } from "../../src/data/brand";

export const metadata: Metadata = { title: `حریم خصوصی — ${BRAND.name}` };

/**
 * What is stored, why, and for how long.
 *
 * Written from the schema rather than from a template. The three things this
 * product holds that a generic privacy policy would not think to mention are
 * the prompt, the reference images somebody uploads, and the generated output —
 * and it holds all three, so it says so. A policy that omits them would be
 * wrong on the day it was published.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="حریم خصوصی"
      updated={LEGAL_UPDATED}
      intro={`این صفحه می‌گوید ${BRAND.name} چه چیزی از تو نگه می‌دارد، چرا، و چقدر. هر چیزی که اینجا نوشته نشده، نگه داشته نمی‌شود.`}
    >
      <Section title="چیزی که خودت می‌دهی">
        <p>
          <strong style={{ color: "var(--vg-text)" }}>پرامپت‌ها.</strong> متنی که برای ساخت می‌نویسی ذخیره می‌شود. بدون آن نه می‌شود کار را
          دوباره ساخت، نه در «کارهای من» نشانت داد، نه هزینه‌اش را توضیح داد.
        </p>
        <p>
          <strong style={{ color: "var(--vg-text)" }}>تصویرهای مرجع.</strong> فایلی که برای مدل بارگذاری می‌کنی در فضای ذخیره‌سازی ما
          می‌ماند، چون بعضی مدل‌ها آن را دوباره لازم دارند و «دوباره بساز» بدون آن همان کار را تحویل نمی‌دهد.
        </p>
        <p>
          <strong style={{ color: "var(--vg-text)" }}>خروجی‌ها.</strong> تصویر، ویدیو یا صدایی که ساخته می‌شود نزد ما می‌ماند تا در حساب تو
          قابل دیدن و دانلود باشد.
        </p>
        <p>
          <strong style={{ color: "var(--vg-text)" }}>حساب.</strong> شمارهٔ موبایل یا نشانی ایمیل، بسته به روشی که با آن وارد می‌شوی. شمارهٔ
          موبایل به شکل درهم‌شده نگه داشته می‌شود، نه به شکل خام.
        </p>
      </Section>

      <Section title="چیزی که خودش ثبت می‌شود">
        <p>
          هر ساخت با مدل، هزینه، زمان و نتیجه‌اش ثبت می‌شود. این همان چیزی است که صورتحساب از آن ساخته می‌شود، پس تا وقتی سابقهٔ مالی لازم
          است می‌ماند.
        </p>
        <p>
          نشانی IP و نوع مرورگر هنگام ورود ثبت می‌شود، برای اینکه ورود مشکوک قابل تشخیص باشد. درخواستی که به دلیل قوانین محتوایی رد شود هم
          ثبت می‌شود.
        </p>
        <p>
          کوکی‌ها فهرست کاملشان در{" "}
          <Link href="/cookies" style={{ color: "var(--vg-primary-soft)" }}>
            صفحهٔ کوکی‌ها
          </Link>{" "}
          آمده است. هیچ ردیاب شخص‌ثالث و هیچ کوکی تبلیغاتی وجود ندارد.
        </p>
      </Section>

      <Section title="چه کسی آن را می‌بیند">
        <p>
          پرامپت و فایل مرجع تو برای ساختن کار به ارائه‌دهندهٔ مدل فرستاده می‌شود. بدون این کار ساختی در کار نیست. جز آن، کارهای تو خصوصی
          است و تا وقتی خودت منتشرشان نکنی کسی جز تو آن‌ها را نمی‌بیند.
        </p>
        <p>
          کارکنان {BRAND.name} به سابقهٔ حساب دسترسی دارند، به اندازه‌ای که نقششان اجازه می‌دهد و نه بیشتر. هر دسترسی مدیریتی ثبت می‌شود.
        </p>
        <p>داده‌ای به هیچ شخص ثالثی فروخته نمی‌شود. در پاسخ به دستور مرجع صالح، آنچه قانون الزام می‌کند ارائه می‌شود.</p>
      </Section>

      <Section title="چقدر می‌ماند">
        <p>
          <Blank>مدت نگه‌داری خروجی‌ها، فایل‌های مرجع و سابقهٔ ساخت را مالک تعیین می‌کند — و باید با الزامات مالیاتی سازگار باشد.</Blank>
        </p>
        <p>
          یک ساخت شکست‌خورده را می‌توانی از «کارهای من» حذف کنی. سطر مالی آن برای سابقهٔ حسابداری می‌ماند، ولی از فهرست کارهای تو بیرون
          می‌رود.
        </p>
      </Section>

      <Section title="حق تو">
        <p>
          می‌توانی بخواهی داده‌ات را ببینی، اصلاح کنی، یا حساب را ببندی. درخواست را از{" "}
          <Link href="/contact" style={{ color: "var(--vg-primary-soft)" }}>
            تماس با ما
          </Link>{" "}
          بفرست.
        </p>
        <p>
          <Blank>نام و نشانی «مسئول حفاظت از داده» را مالک وارد می‌کند.</Blank>
        </p>
      </Section>
    </LegalPage>
  );
}
