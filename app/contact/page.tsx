import type { Metadata } from "next";
import { Blank, LegalPage, LEGAL_UPDATED, Section } from "../../src/components/LegalPage";
import { BRAND } from "../../src/data/brand";

export const metadata: Metadata = { title: `تماس با ما — ${BRAND.name}` };

/**
 * How to reach a person.
 *
 * Four of these are not decoration. A landline is verified by callback, the
 * mobile is checked against the national registry and must be in the owner's
 * own name, the email must be on this domain — Gmail and Outlook are rejected
 * outright — and the postal address is compared against the registration
 * documents. Every one of them is left blank rather than guessed, because a
 * plausible wrong answer here is the most common reason a submission fails.
 */
export default function ContactPage() {
  return (
    <LegalPage
      title="تماس با ما"
      updated={LEGAL_UPDATED}
      intro={`اگر سؤالی داری، مشکلی پیش آمده، یا می‌خواهی دربارهٔ حسابت با کسی حرف بزنی، از این راه‌ها به ${BRAND.name} برس.`}
    >
      <Section title="راه‌های تماس">
        <p>
          <Blank>نشانی پستی کامل، با کد پستی — همان نشانی مدارک ثبتی.</Blank>
        </p>
        <p>
          <Blank>تلفن ثابت. با تماس تأیید می‌شود، پس باید در ساعات کاری پاسخ داده شود.</Blank>
        </p>
        <p>
          <Blank>شمارهٔ موبایل، به نام خودِ مالک. شماره‌ای که به نام شخص دیگری باشد رد می‌شود.</Blank>
        </p>
        <p>
          <Blank>نشانی ایمیل روی دامنهٔ خودِ سایت. جی‌میل، یاهو و اوت‌لوک پذیرفته نمی‌شوند.</Blank>
        </p>
        <p>
          <Blank>ساعات پاسخ‌گویی.</Blank>
        </p>
      </Section>

      <Section title="گزارش محتوا">
        <p>
          اگر محتوایی در بخش عمومی سایت دیدی که به نظرت نباید آنجا باشد، از همین راه‌ها خبر بده و نشانی آن را بفرست. محتوای گزارش‌شده بررسی
          می‌شود و در صورت لزوم از دسترس عمومی خارج می‌شود.
        </p>
      </Section>
    </LegalPage>
  );
}
