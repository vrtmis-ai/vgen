import type { Metadata } from "next";
import { Blank, LegalPage, LEGAL_UPDATED, Section } from "../../src/components/LegalPage";
import { BRAND } from "../../src/data/brand";

export const metadata: Metadata = { title: `دربارهٔ ما — ${BRAND.name}` };

/**
 * Who is behind the brand.
 *
 * Almost entirely the owner's to fill in, and deliberately so: an evaluator
 * checks this page against the registration documents line by line, and the
 * most common reason a submission is rejected is identity data that does not
 * match. Every field here is left blank rather than guessed.
 *
 * What the software can say for itself — what the product is — is written out,
 * so the page is not empty while it waits.
 */
export default function AboutPage() {
  return (
    <LegalPage
      title="دربارهٔ ما"
      updated={LEGAL_UPDATED}
      intro={`${BRAND.name} یک استودیوی ساخت تصویر، ویدیو و صداست که با مدل‌های روز کار می‌کند و برای کاربر فارسی‌زبان ساخته شده.`}
    >
      <Section title="چه می‌کنیم">
        <p>
          {BRAND.name} مدل‌های مولد را در یک جا جمع می‌کند: می‌نویسی، مدل را انتخاب می‌کنی، و نتیجه در حساب خودت می‌ماند. پرداخت با کارت
          ایرانی است و همه‌چیز فارسی است — از رابط تا پشتیبانی.
        </p>
        <p>{BRAND.tagline}</p>
      </Section>

      <Section title="هویت حقوقی">
        <p>
          <Blank>نام کامل مالک یا شرکت، دقیقاً همان‌طور که در مدارک ثبتی آمده است.</Blank>
        </p>
        <p>
          <Blank>نوع ثبت: حقیقی یا حقوقی. اگر حقوقی است، شمارهٔ ثبت و شناسهٔ ملی.</Blank>
        </p>
        <p>
          <Blank>شمارهٔ اقتصادی و کد رهگیری مالیاتی.</Blank>
        </p>
        <p>
          <Blank>نشانی کامل محل کسب‌وکار، همان نشانی که در مدارک ثبتی است.</Blank>
        </p>
      </Section>

      <Section title="مجوزها">
        <p>
          <Blank>
            نماد اعتماد الکترونیکی: کد رسمی را به شکل اسکریپت لینک‌دار قرار بده، نه به شکل تصویر ساده. نماد جعلی یا بدون لینک صریحاً ممنوع
            است.
          </Blank>
        </p>
        <p>
          <Blank>مجوز نظام صنفی رایانه‌ای، و در صورت اخذ، ساماندهی وزارت ارشاد.</Blank>
        </p>
      </Section>
    </LegalPage>
  );
}
