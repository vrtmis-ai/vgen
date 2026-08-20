import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CaretUp, CaretDown, Eye, EyeSlash, Archive, ArrowCounterClockwise, Lock } from "@phosphor-icons/react";
import type { AdminRole, ContentRecord, ContentStatus } from "../data/content";
import seed from "../data/content.rows.json";
import { moveRecord, patchRecord, resetRecord, useAllContent, useOverrideCount } from "../data/contentStore";
import { useAudit } from "../data/adminAudit";
import { BRAND } from "../data/brand";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The admin panel.

   docs/admin.md called it "a surface over records that already exist", and that
   is exactly what this is: no new data model, no new read path. Every user
   screen already reads through `published()`, every collection already carries
   status/order/updatedAt/updatedBy. This adds the writes.

   Two things it deliberately is NOT:

   It is not one `isAdmin` flag. The person who uploads an effect is not the
   person who issues credits, and the day those become one permission is the day
   a content mistake can move money. Roles gate whole sections, and a role that
   cannot do something does not see a disabled button for it — it sees nothing,
   because a disabled Refund button is still an invitation to find out who can
   press it.

   It is not a place that invents numbers. Revenue, users and job history live
   in the backend and the backend is not wired to this yet. Those panels say so
   rather than showing a plausible chart, because a made-up revenue figure in an
   admin panel is worse than no panel at all.
   --------------------------------------------------------------------------- */

/**
 * The rows this panel stages, taken from the seed file rather than from seven
 * TypeScript modules that no longer exist.
 *
 * `content_items` is what the product reads now, and `GET /content` serves it
 * already filtered to published and already ordered — so the served payload
 * carries neither `status` nor `order`, and this panel is about exactly those
 * two fields. The seed file is the one place they still exist in the browser,
 * and it is the same file that seeds the table, so the panel and the database
 * are looking at one list rather than two.
 *
 * That also states this panel's honest limit: it stages a change in
 * localStorage and nothing downstream reads it. The write path is
 * `PUT /api/v1/admin/...`, which exists on the server and has no browser
 * caller yet.
 */
interface SeededRecord extends ContentRecord {
  label: string;
}

const seeded = (kind: string, label: (row: (typeof seed.rows)[number]) => string): SeededRecord[] =>
  seed.rows
    .filter((row) => row.kind === kind)
    .map((row) => ({
      id: row.code,
      status: row.status as ContentStatus,
      order: row.sortOrder,
      // The seed file carries no timestamp: the column's default is `now()` at
      // insert, so the only truthful answer here is "whenever it was seeded".
      updatedAt: 0,
      label: label(row),
    }));

const ROLE_LABEL: Record<AdminRole, string> = {
  content: "محتوا",
  commerce: "فروش",
  support: "پشتیبانی",
  owner: "مالک",
};

const ROLE_BLURB: Record<AdminRole, string> = {
  content: "افکت‌ها، دوره‌ها، قفسه‌ها و بانک پرامپت. هیچ چیز مالی.",
  commerce: "پلن‌ها، قیمت‌ها، اعطای اعتبار و بازپرداخت. هیچ محتوایی.",
  support: "دیدن کاربر و جاب، اجرای دوباره یا بازپرداخت یک جاب.",
  owner: "همه‌چیز، از جمله دادن نقش.",
};

const STATUS_LABEL: Record<ContentStatus, string> = {
  published: "منتشرشده",
  draft: "پیش‌نویس",
  archived: "بایگانی",
};

/** Who may open which section. Kept as data, not scattered `if`s. */
const CAN: Record<AdminRole, ("content" | "commerce" | "support")[]> = {
  content: ["content"],
  commerce: ["commerce"],
  support: ["support"],
  owner: ["content", "commerce", "support"],
};

/** The admin identity a write is attributed to. Stands in for the signed-in
 *  admin account until the backend can answer who that is — `updatedBy` has to
 *  carry something real from the first write, per docs/admin.md §4. */
const ACTING_ADMIN = "local-admin";

function StatusPill({ status }: { status: ContentStatus }) {
  const tone =
    status === "published"
      ? { bg: "var(--vg-primary-a18)", fg: "var(--vg-primary-soft)" }
      : status === "draft"
        ? { bg: "var(--vg-surface-overlay)", fg: "var(--vg-text-secondary)" }
        : { bg: "transparent", fg: "var(--vg-text-faint)" };
  return (
    <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * One editable collection.
 *
 * Generic over the record because the four collections differ only in which
 * field is the title — everything the panel does (publish, order, revert) is a
 * property of ContentRecord, which is the whole reason those fields were added
 * before this screen existed.
 */
function Collection<T extends ContentRecord>({
  title,
  note,
  rows,
  label,
}: {
  title: string;
  note: string;
  rows: T[];
  label: (row: T) => string;
}) {
  const { n } = useI18n();
  const live = useAllContent(rows);
  const publishedCount = live.filter((r) => r.status === "published").length;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
          {title}
        </h2>
        <span className="vg-numeric text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
          {n(publishedCount)} از {n(live.length)} منتشرشده
        </span>
      </div>
      <p className="mt-0.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        {note}
      </p>

      <div className="mt-3 overflow-hidden rounded-bezel border border-line">
        {live.map((row, i) => (
          <div
            key={row.id}
            className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0"
            style={{ borderColor: "var(--vg-border-subtle)" }}
          >
            {/* Order. Two buttons rather than drag: a keyboard reaches these,
                and a list that is reordered once a week does not need a
                pointer-only affordance. */}
            <span className="flex shrink-0 flex-col">
              <button
                onClick={() => moveRecord(rows, row.id, -1, ACTING_ADMIN)}
                disabled={i === 0}
                aria-label={`بالا بردن ${label(row)}`}
                className="grid size-5 place-items-center rounded disabled:opacity-25"
                style={{ color: "var(--vg-text-muted)" }}
              >
                <CaretUp size={11} weight="bold" />
              </button>
              <button
                onClick={() => moveRecord(rows, row.id, 1, ACTING_ADMIN)}
                disabled={i === live.length - 1}
                aria-label={`پایین بردن ${label(row)}`}
                className="grid size-5 place-items-center rounded disabled:opacity-25"
                style={{ color: "var(--vg-text-muted)" }}
              >
                <CaretDown size={11} weight="bold" />
              </button>
            </span>

            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[13px]"
                style={{ color: row.status === "published" ? "var(--vg-text)" : "var(--vg-text-muted)" }}
              >
                {label(row)}
              </span>
              {row.updatedBy && (
                <span className="block text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                  آخرین تغییر: {row.updatedBy}
                </span>
              )}
            </span>

            <StatusPill status={row.status} />

            {/* Publish / unpublish is the button an admin presses most, so it is
                the one that carries a word instead of only an icon. */}
            <button
              onClick={() => patchRecord(row.id, { status: row.status === "published" ? "draft" : "published" }, ACTING_ADMIN)}
              className="vg-tap flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11.5px] font-bold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
            >
              {row.status === "published" ? <EyeSlash size={12} /> : <Eye size={12} />}
              {row.status === "published" ? "پنهان" : "انتشار"}
            </button>

            <button
              onClick={() => patchRecord(row.id, { status: "archived" }, ACTING_ADMIN)}
              aria-label={`بایگانی ${label(row)}`}
              title="بایگانی"
              className="vg-tap grid size-7 shrink-0 place-items-center rounded-lg"
              style={{ color: "var(--vg-text-muted)" }}
            >
              <Archive size={13} />
            </button>

            {/* Only where there is an edit to undo — a revert button on an
                untouched row promises to change something and does nothing. */}
            {row.updatedBy && (
              <button
                onClick={() => resetRecord(rows, row.id)}
                aria-label={`بازگرداندن ${label(row)} به حالت اولیه`}
                title="بازگرداندن"
                className="vg-tap grid size-7 shrink-0 place-items-center rounded-lg"
                style={{ color: "var(--vg-text-muted)" }}
              >
                <ArrowCounterClockwise size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A section that has no data behind it yet, said plainly. */
function NotWired({ title, needs }: { title: string; needs: string }) {
  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        {title}
      </h2>
      <div className="mt-2 rounded-bezel border border-line p-4">
        <p className="text-[12.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          {needs}
        </p>
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
          این بخش عمداً خالی است. یک عدد ساختگی در پنل مدیریت بدتر از نبودن آن بخش است.
        </p>
      </div>
    </section>
  );
}

export default function Admin({ onBack }: { onBack: () => void }) {
  const { n } = useI18n();
  /* The role is picked here because there is no admin auth yet. It is a
     stand-in for a claim on the session, and it is honest about that — the
     alternative, defaulting everyone to owner, would make the role split
     invisible and it would rot before it was ever enforced. */
  const [role, setRole] = useState<AdminRole>("owner");
  const allowed = CAN[role];
  const overrides = useOverrideCount();
  const audit = useAudit();

  const fmt = useMemo(() => new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }), []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[900px] px-4 pb-20 pt-5">
      <button
        onClick={onBack}
        className="vg-tap mb-5 flex h-9 items-center gap-1.5 text-[12.5px] font-bold"
        style={{ color: "var(--vg-text-muted)" }}
      >
        <ArrowRight size={14} weight="bold" />
        بازگشت به سایت
      </button>

      <h1
        className="text-[30px] font-extrabold leading-tight md:text-[38px]"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
      >
        پنل مدیریت <bdi>{BRAND.name}</bdi>
      </h1>

      <div className="mt-4 rounded-bezel border border-line p-3">
        <p className="text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
          نقش فعال — تا وقتی ورود ادمین به بک‌اند وصل نشده، اینجا انتخاب می‌شود
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className="h-8 rounded-lg px-3 text-[12px] font-semibold"
              style={{
                background: role === r ? "var(--vg-primary-a18)" : "var(--vg-surface)",
                color: role === r ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                border: "1px solid var(--vg-border-subtle)",
              }}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px]" style={{ color: "var(--vg-text-secondary)" }}>
          {ROLE_BLURB[role]}
        </p>
      </div>

      {overrides > 0 && (
        <p className="mt-3 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
          <span className="vg-numeric">{n(overrides)}</span> رکورد نسبت به نسخهٔ منتشرشده تغییر کرده و در این مرورگر ذخیره شده است. وقتی
          بک‌اند وصل شود همین تغییرات روی سرور می‌نشیند.
        </p>
      )}

      {allowed.includes("content") ? (
        <>
          <Collection
            title="افکت‌ها"
            note="هر افکت یک پرامپت کامل است. ترتیب همان چیزی است که در صفحهٔ افکت‌ها دیده می‌شود."
            rows={seeded("preset", (row) => row.title ?? row.code)}
            label={(p) => p.label}
          />
          <Collection
            title="دوره‌ها"
            note="همیشه رایگان — قیمت عمداً در مدل داده وجود ندارد."
            rows={seeded("course", (row) => row.title ?? row.code)}
            label={(c) => c.label}
          />
          <Collection
            title="قفسهٔ ویژهٔ اکسپلور"
            note="اولین چیزی که کاربر بعد از ورود می‌بیند."
            rows={seeded("featured", (row) => row.title ?? row.code)}
            label={(f) => f.label}
          />
          <Collection
            title="بانک پرامپت"
            note="واژه‌های حرفه‌ای برای توصیف نما، در آکادمی."
            rows={seeded("prompt_fragment", (row) => row.title ?? row.code)}
            label={(x) => x.label}
          />
        </>
      ) : (
        <section className="mt-8 flex items-center gap-2 rounded-bezel border border-line p-4">
          <Lock size={14} style={{ color: "var(--vg-text-faint)" }} />
          <p className="text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
            نقش «{ROLE_LABEL[role]}» به محتوا دسترسی ندارد.
          </p>
        </section>
      )}

      {allowed.includes("commerce") && (
        <>
          <section className="mt-8">
            <h2 className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
              دفتر تغییرات مالی
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
              هر اعطای اعتبار و هر بازپرداخت، با شناسهٔ ادمین و دلیل. فقط افزودنی — پاک نمی‌شود.
            </p>
            <div className="mt-3 rounded-bezel border border-line">
              {audit.length === 0 ? (
                <p className="p-4 text-[12.5px]" style={{ color: "var(--vg-text-faint)" }}>
                  هنوز چیزی ثبت نشده. اولین اعطای اعتبار همین‌جا می‌نشیند.
                </p>
              ) : (
                audit.map((e) => (
                  <div key={e.id} className="border-b px-3 py-2.5 last:border-b-0" style={{ borderColor: "var(--vg-border-subtle)" }}>
                    <p className="text-[12.5px]" style={{ color: "var(--vg-text)" }}>
                      {e.kind} · <bdi>{e.target}</bdi>
                      {e.amount != null && <span className="vg-numeric"> · {n(e.amount)} سکه</span>}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                      {e.reason} — <bdi>{e.by}</bdi> · {fmt.format(e.at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <NotWired
            title="پلن‌ها، قیمت و گزارش درآمد"
            needs="قیمت ریالی، کد تخفیف، ضریب قیمت هر مدل و گزارش درآمد به جدول‌های plans و orders در بک‌اند وصل می‌شوند. آن جدول‌ها ساخته شده‌اند ولی هنوز از این پنل خوانده نمی‌شوند."
          />
        </>
      )}

      {allowed.includes("support") && (
        <NotWired
          title="کاربران و جاب‌ها"
          needs="جستجوی کاربر، دیدن دفتر اعتبارش، دیدن جاب‌هایش و اجرای دوباره یا بازپرداخت یک جاب. همه به endpointهای ادمین نیاز دارند که هنوز نوشته نشده‌اند."
        />
      )}
    </motion.div>
  );
}
