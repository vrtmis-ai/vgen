import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalPage, LEGAL_UPDATED, Section } from "../../src/components/LegalPage";
import { BRAND } from "../../src/data/brand";

export const metadata: Metadata = { title: `قوانین و مقررات — ${BRAND.name}` };

/**
 * The terms of use, and the page the content policy lives on.
 *
 * Two audiences and they want different things. A customer wants to know what
 * they bought and what they may not ask for. A reviewer wants to see that the
 * platform has said, in writing, that it does not produce unlawful material —
 * because a service that takes arbitrary prompts and returns pictures is a
 * content platform whether or not it describes itself as one.
 *
 * What is stated here is only what the software actually does; everything that
 * is a decision about the business is marked and left to the owner. A plausible
 * invented term is worse than a gap — it reads as true and is checked.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="قوانین و مقررات"
      updated={LEGAL_UPDATED}
      /* The version is deliberately not printed here. It is recorded against
         the account at signup, and a second copy of the string in the browser
         bundle is a second thing to keep in step with the first. */
      intro={`با ساختن حساب در ${BRAND.name} این شرایط را می‌پذیری. نسخه‌ای که پذیرفته‌ای، همراه با تاریخ آن، در حساب تو ثبت می‌شود.`}
    >
      <Section title="این سرویس چه می‌فروشد">
        <p>
          {BRAND.name} اعتبار ساخت (سکه) می‌فروشد. هر ساخت — تصویر، ویدیو یا صدا — پیش از شروع قیمت می‌خورد و همان مقدار از موجودی تو نگه
          داشته می‌شود. اگر ساخت کامل شود، آن مقدار برداشته می‌شود؛ اگر شکست بخورد، تمام آن به حساب برمی‌گردد و چیزی از تو کم نمی‌شود.
        </p>
        <p>
          خرید اشتراک، اعتبار یک دوره را یک‌جا به حساب اضافه می‌کند. سقف هر دوره همان مقداری است که در صفحهٔ{" "}
          <Link href="/plans" style={{ color: "var(--vg-primary-soft)" }}>
            پلن‌ها
          </Link>{" "}
          نوشته شده.
        </p>
      </Section>

      <Section title="چه چیزی نمی‌شود ساخت">
        <p>
          پرامپت‌ها پیش از ارسال به مدل بررسی می‌شوند. درخواستی که با مصادیق محتوای مجرمانه هم‌خوانی داشته باشد، رد می‌شود و هزینه‌ای بابت
          آن گرفته نمی‌شود. رد شدن یک درخواست ثبت می‌شود.
        </p>
        <p>
          <Blank>فهرست دقیق موارد ممنوع را مالک یا مشاور حقوقی می‌نویسد — این متن باید صریح باشد و به مصادیق منتشرشده ارجاع دهد.</Blank>
        </p>
        <p>
          ساختن محتوا از تصویر افراد واقعی بدون رضایت آن‌ها، جعل هویت، و هر کاری که حقوق مالکیت فکری دیگری را نقض کند، ممنوع است. مسئولیت
          پرامپت و فایلی که بارگذاری می‌کنی با توست.
        </p>
      </Section>

      <Section title="چیزی که می‌سازی">
        <p>
          خروجی هر ساخت برای حساب توست و می‌توانی آن را دانلود کنی. انتشار عمومی آن در بخش اکسپلور اختیاری است، جداگانه از تو پرسیده می‌شود،
          و تا وقتی یک نفر از تیم آن را تأیید نکند منتشر نمی‌شود. اجازهٔ نمایش پرامپت هم پرسش جداگانه‌ای است.
        </p>
        <p>
          {BRAND.name} می‌تواند محتوای منتشرشده را در صورت دریافت شکایت یا دستور مرجع صالح از دسترس عمومی خارج کند. سابقهٔ این کار ثبت
          می‌شود.
        </p>
      </Section>

      <Section title="حساب">
        <p>
          حساب برای خودت است. اشتراک‌گذاری دسترسی، تلاش برای دور زدن محدودیت‌ها، و استفادهٔ خودکار بدون توافق کتبی، دلیل بستن حساب است.
          حسابی که بسته شود، دیگر نمی‌تواند ساخت جدید شروع کند.
        </p>
      </Section>

      <Section title="تغییر این شرایط">
        <p>
          این متن ممکن است تغییر کند. نسخهٔ هر تغییر عوض می‌شود و نسخه‌ای که تو پذیرفته‌ای همان می‌ماند تا زمانی که نسخهٔ تازه را بپذیری.
        </p>
        <p>
          <Blank>قانون حاکم و مرجع رسیدگی به اختلاف را مالک تعیین می‌کند.</Blank>
        </p>
      </Section>

      <Section title="مرتبط">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacy" style={{ color: "var(--vg-primary-soft)" }}>
            حریم خصوصی
          </Link>
          <Link href="/coins" style={{ color: "var(--vg-primary-soft)" }}>
            خرید، تحویل و بازگشت وجه
          </Link>
          <Link href="/cookies" style={{ color: "var(--vg-primary-soft)" }}>
            کوکی‌ها
          </Link>
          <Link href="/contact" style={{ color: "var(--vg-primary-soft)" }}>
            تماس با ما
          </Link>
        </p>
      </Section>
    </LegalPage>
  );
}
