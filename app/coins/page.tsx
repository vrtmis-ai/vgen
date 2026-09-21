import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalPage, LEGAL_UPDATED, Section } from "../../src/components/LegalPage";
import { BRAND } from "../../src/data/brand";

export const metadata: Metadata = { title: `خرید، تحویل و بازگشت وجه — ${BRAND.name}` };

/**
 * Sales, delivery and refund terms.
 *
 * The page people skip, and the one the sales-transparency category is about.
 * For a credits product the questions are specific and all four have real
 * answers in the code: what happens when a generation fails, whether credits
 * come back, whether unused credits are refundable, and how long they live.
 *
 * The first two are facts about the software and are stated. The second two are
 * commercial policy and are marked — the code holds an expiry date on every
 * credit lot but nothing decides what that date should be.
 */
export default function CoinsPage() {
  return (
    <LegalPage
      title="خرید، تحویل و بازگشت وجه"
      updated={LEGAL_UPDATED}
      intro={`${BRAND.name} کالای فیزیکی نمی‌فروشد. چیزی که می‌خری اعتبار ساخت است، و این صفحه می‌گوید دقیقاً کِی از تو کم می‌شود، کِی برمی‌گردد، و چه وقت از بین می‌رود.`}
    >
      <Section title="چه می‌خری">
        <p>
          سکه، اعتبار ساخت است. قیمت هر ساخت به مدل، اندازه و مدت آن بستگی دارد و{" "}
          <strong style={{ color: "var(--vg-text)" }}>پیش از شروع</strong> روی همان صفحه به تو نشان داده می‌شود. تا وقتی آن را نپذیری، چیزی
          کم نمی‌شود.
        </p>
        <p>
          اشتراک، اعتبار یک دوره را یک‌جا اضافه می‌کند و سطح دسترسی به مدل‌ها را بالا می‌برد. مقدار هر پلن در صفحهٔ{" "}
          <Link href="/plans" style={{ color: "var(--vg-primary-soft)" }}>
            پلن‌ها
          </Link>{" "}
          نوشته شده.
        </p>
      </Section>

      <Section title="تحویل">
        <p>
          تحویل آنی و الکترونیکی است. به محض تأیید پرداخت، اعتبار به حساب اضافه می‌شود و بلافاصله قابل استفاده است. چیزی پست نمی‌شود و نشانی
          فیزیکی لازم نیست.
        </p>
      </Section>

      <Section title="وقتی ساخت شکست بخورد">
        <p>
          هزینهٔ هر ساخت هنگام شروع فقط <strong style={{ color: "var(--vg-text)" }}>نگه داشته</strong> می‌شود، نه برداشته. اگر ساخت به نتیجه
          نرسد — به هر دلیلی، از خطای ارائه‌دهنده تا قطعی — همان مقدار به‌طور کامل آزاد می‌شود و صفر از تو کم می‌شود. این کار خودکار است و
          لازم نیست درخواستش کنی.
        </p>
        <p>
          روی کارت هر ساخت ناموفق نوشته می‌شود که سکه‌ها برگشته‌اند. اگر جایی این را ندیدی، از{" "}
          <Link href="/contact" style={{ color: "var(--vg-primary-soft)" }}>
            تماس با ما
          </Link>{" "}
          بگو.
        </p>
      </Section>

      <Section title="ساختی که خودت نپسندیدی">
        <p>
          ساختی که کامل شده و فایلش تحویل داده شده، مصرف‌شده حساب می‌شود. مدل‌های مولد قطعی نیستند و نتیجه با سلیقهٔ هر کس فرق می‌کند، پس
          نپسندیدن خروجی به‌تنهایی دلیل بازگشت اعتبار نیست.
        </p>
      </Section>

      <Section title="بازگشت وجه">
        <p>
          <Blank>
            سیاست بازگشت وجه برای اعتبار مصرف‌نشده را مالک تعیین می‌کند: بازهٔ زمانی، شرایط، و اینکه بازگشت به کارت انجام می‌شود یا به شکل
            اعتبار. این بند پیش از ارسال به اینماد باید پر شود.
          </Blank>
        </p>
        <p>
          <Blank>مهلت انصراف از اشتراک تازه‌خریداری‌شده را هم مالک تعیین می‌کند.</Blank>
        </p>
      </Section>

      <Section title="اعتبار چقدر می‌ماند">
        <p>
          هر بستهٔ اعتبار تاریخ انقضای خودش را دارد و در حساب تو، در بخش موجودی، دیده می‌شود. اعتبار دوره‌ای اشتراک با پایان همان دوره از
          بین می‌رود.
        </p>
        <p>
          <Blank>مدت اعتبارِ سکه‌های خریداری‌شدهٔ جداگانه را مالک تعیین می‌کند.</Blank>
        </p>
      </Section>

      <Section title="قیمت و مالیات">
        <p>
          <Blank>وضعیت مالیات بر ارزش افزوده و اینکه قیمت‌های نمایش‌داده‌شده شامل آن هست یا نه، باید اینجا صریح نوشته شود.</Blank>
        </p>
      </Section>
    </LegalPage>
  );
}
