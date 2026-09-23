import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Play, Lock, Clock, Copy, Check, ArrowUpRight, MagnifyingGlass } from "@phosphor-icons/react";
import { LEVEL_LABEL, courseMinutes } from "../features/content/labels";
import { useShelves } from "../features/content/categories";
import { usePublishedContent } from "../features/content/ContentProvider";
import { CourseCover, mediaSrc } from "../features/content/media";
import type { Course, Lesson } from "../runtime/contracts/content";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";

import { useI18n } from "../lib/i18n";
import { brandPhrase } from "../data/brand";

/* ---------------------------------------------------------------------------
   VGen Academy.

   The reference gives this its own nav item, and the reason is commercial
   rather than educational: a user who cannot write a prompt does not spend, and
   no amount of catalog work fixes that. A course is the slow, sticky version of
   what the presets grid does fast.

   Their layout: one wide hero card with the headline split across two lines —
   first line accent, second white — then a plain white section heading and a
   3-up grid of 16:9 cards with the title BELOW the card. Note the section
   heading here is white, not accent: on a page that is entirely one topic, an
   accent heading per shelf stops meaning anything.
   --------------------------------------------------------------------------- */

const art = (seed: string, w = 800, h = 450) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function CourseCard({ c, onOpen }: { c: Course; onOpen: () => void }) {
  const { n } = useI18n();
  return (
    <button onClick={onOpen} className="group block w-full text-start">
      <div className="relative overflow-hidden rounded-xl" style={{ background: "var(--vg-surface)" }}>
        <CourseCover course={c} className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        <span
          className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          <span
            className="grid size-11 place-items-center rounded-full"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <Play size={17} weight="fill" />
          </span>
        </span>
        <span
          className="absolute bottom-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] backdrop-blur-md"
          style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.6)", color: "var(--vg-text-secondary)" }}
        >
          <Clock size={11} />
          <span className="vg-numeric">{n(courseMinutes(c))}</span> دقیقه
        </span>
      </div>

      <p className="mt-2.5 text-[14px] font-bold leading-snug" style={{ color: "var(--vg-text)" }}>
        {c.title}
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-5" style={{ color: "var(--vg-text-muted)" }}>
        {c.blurb}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="rounded-md px-1.5 py-0.5 text-[10.5px]"
          style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
        >
          {LEVEL_LABEL[c.level]}
        </span>
        {/* text-muted, not text-faint — a semantic split, not a contrast one.
            Faint was below AA when this was written; the token has since been
            corrected and now measures 5.79:1 on this surface, so both would
            pass. The distinction that remains is meaning: faint is for
            placeholder and disabled, and a lesson count is neither. */}
        <span className="vg-numeric text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
          {n(c.lessons.length)} درس
        </span>
        {/* Every course, no exceptions — see data/academy. The branch that used
            to be here made free look like a sale on five priced ones. */}
        <span className="ms-auto text-[11.5px] font-semibold" style={{ color: "var(--vg-primary-soft)" }}>
          رایگان
        </span>
      </div>
    </button>
  );
}

/* The prompt bank. Theirs sits under the courses and is the more useful half of
   the page: a course teaches you to make one thing, the bank teaches you the
   words. Grouped exactly as theirs is — a category heading, then the terms.

   Copy is the primary action, not "open in studio". These are fragments that
   compose — a camera move plus a lighting setup plus a lens is one shot — so
   the user is assembling a sentence, not choosing a preset. Sending them to the
   studio on every click would throw away the two fragments they already had. */
/** Case, Arabic letter forms and the half-space are not what anybody means to search by. */
function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ");
}

function BankSection({ onOpenModel }: { onOpenModel: (familyId: string, prompt?: string) => void }) {
  const { n } = useI18n();
  const families = useCatalogFamilies();
  const entries = usePublishedContent().fragments;
  const shelves = useShelves("prompt_fragment");
  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // Taken from the catalog rather than written in. Every term here is a
  // cinematography term, so video is the right destination — but naming one
  // family in this file means the button dies silently the day that family is
  // renamed or archived, and nothing would fail loudly enough to notice.
  const videoFamily = useMemo(() => families.find((f) => f.kind === "video") ?? null, [families]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  // Published shelves that actually hold something, in the admin's order.
  const cats = shelves.list.map((shelf) => shelf.slug).filter((slug) => entries.some((x) => x.category === slug));
  // Nothing chosen yet, or the chosen shelf was emptied or unpublished: open on
  // the first one that has terms rather than on a tab with nothing under it.
  const active = cat && cats.includes(cat) ? cat : (cats[0] ?? "");
  // A search looks through every category — someone typing "dolly" should not
  // first have to know it is filed under camera — and matches the Persian
  // name, the English term and the note alike.
  const needle = normalise(query);
  const shown = needle
    ? entries.filter((x) => [x.label, x.fragment, x.note].some((text) => normalise(text).includes(needle)))
    : entries.filter((x) => x.category === active);

  return (
    <section className="mt-14">
      <h2 className="text-[20px] font-extrabold md:text-[26px]" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        بانک پرامپت
      </h2>
      <p className="mt-1 max-w-[62ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
        واژه‌های حرفه‌ای برای توصیف یک نما. اینها تکه‌اند نه پرامپت کامل — کنار هم بچینشان. متن انگلیسی است چون مدل‌ها با همین اصطلاح‌ها
        آموزش دیده‌اند.
      </p>

      <label className="relative mt-4 block max-w-[420px]">
        <MagnifyingGlass
          size={15}
          className="pointer-events-none absolute top-1/2 -translate-y-1/2"
          style={{ insetInlineStart: "0.75rem", color: "var(--vg-text-faint)" }}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="جستجو در بانک پرامپت…"
          aria-label="جستجو در بانک پرامپت"
          className="h-10 w-full rounded-xl ps-9 pe-3 text-[13px] outline-none"
          style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", color: "var(--vg-text)" }}
        />
      </label>

      <div className="hide-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        {cats.map((c) => {
          const on = !needle && c === active;
          return (
            <button
              key={c}
              onClick={() => {
                setCat(c);
                setQuery("");
              }}
              aria-pressed={on}
              className="h-9 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
              style={{
                background: on ? "var(--vg-primary-a14)" : "var(--vg-surface)",
                color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                border: "1px solid var(--vg-border-subtle)",
              }}
            >
              {shelves.labelOf(c)}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[12px]" style={{ color: "var(--vg-text-faint)" }} aria-live="polite">
        {needle ? (shown.length ? `${n(shown.length)} نتیجه` : "چیزی پیدا نشد.") : shelves.blurbOf(active)}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((x) => (
          <div
            key={x.id}
            className="rounded-xl p-3"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
                  {x.label}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-5" style={{ color: "var(--vg-text-muted)" }}>
                  {x.note}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(x.fragment).then(() => setCopied(x.id));
                  }}
                  aria-label={`کپی ${x.label}`}
                  className="vg-tap grid size-8 place-items-center rounded-lg transition-colors hover:bg-white/[0.07]"
                  style={{ color: copied === x.id ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }}
                >
                  {copied === x.id ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                </button>
                {videoFamily && (
                  <button
                    onClick={() => onOpenModel(videoFamily.id, x.fragment)}
                    aria-label={`ساخت با ${x.label}`}
                    className="vg-tap grid size-8 place-items-center rounded-lg transition-colors hover:bg-white/[0.07]"
                    style={{ color: "var(--vg-text-muted)" }}
                  >
                    <ArrowUpRight size={14} weight="bold" />
                  </button>
                )}
              </div>
            </div>
            {/* The fragment itself, verbatim. Latin inside an RTL card, so it
                carries its own direction or the comma lands on the wrong end. */}
            <p
              className="ltr mt-2 rounded-lg px-2 py-1.5 text-[11.5px] leading-5"
              style={{ background: "var(--vg-canvas)", color: "var(--vg-text-secondary)" }}
            >
              {x.fragment}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Academy({ onOpenModel }: { onOpenModel: (familyId: string, prompt?: string) => void }) {
  const courses = usePublishedContent().courses;
  const [open, setOpen] = useState<Course | null>(null);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[1000px] px-4 pb-20 pt-6">
      {/* The hero: a single wide card, headline split accent/white. */}
      <div className="relative overflow-hidden rounded-2xl" style={{ background: "var(--vg-surface)" }}>
        <img src={art("vgen-academy-hero", 1400, 620)} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.35) 70%)" }} />
        <div className="relative flex min-h-[300px] flex-col justify-end p-7 md:p-10">
          <p className="mb-2 text-[13px] font-bold" style={{ color: "var(--vg-text-secondary)" }}>
            {brandPhrase("آکادمی")}
          </p>
          <h1 className="text-[30px] font-extrabold leading-[1.2] md:text-[40px]" style={{ fontFamily: "var(--vg-font-display)" }}>
            <span style={{ color: "var(--vg-primary-soft)" }}>ساختن یاد بگیر،</span>
            <br />
            <span style={{ color: "var(--vg-text)" }}>نه فقط دکمه‌زدن</span>
          </h1>
          <p className="mt-3 max-w-[52ch] text-[13px] leading-6" style={{ color: "var(--vg-text-secondary)" }}>
            دوره‌های کوتاه و فارسی از کسانی که با همین مدل‌ها کار واقعی تحویل می‌دهند. یک دوره را تمام کن، یک بریف واقعی بگیر.
          </p>
        </div>
      </div>

      <h2 className="mb-3 mt-9 text-[20px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        ببین و یاد بگیر
      </h2>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((c) => (
          <CourseCard key={c.id} c={c} onOpen={() => setOpen(c)} />
        ))}
      </div>

      <BankSection onOpenModel={onOpenModel} />

      {open && <CourseSheet course={open} onClose={() => setOpen(null)} onOpenModel={onOpenModel} />}
    </motion.div>
  );
}

/**
 * One course, and now the place its lessons play.
 *
 * The player takes the cover's place rather than opening over the sheet: the
 * lesson list stays under it, so moving to the next lesson is one tap and the
 * syllabus never leaves the screen.
 */
function CourseSheet({
  course: open,
  onClose,
  onOpenModel,
}: {
  course: Course;
  onClose: () => void;
  onOpenModel: (familyId: string, prompt?: string) => void;
}) {
  const { n } = useI18n();
  const [playing, setPlaying] = useState<Lesson | null>(null);
  const first = open.lessons.find((lesson) => lesson.videoUrl);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(9,9,9,0.9)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {playing?.videoUrl ? (
          <video
            key={playing.id}
            src={mediaSrc(playing.videoUrl)}
            controls
            autoPlay
            playsInline
            className="mb-4 aspect-video w-full rounded-xl bg-black"
            aria-label={playing.title}
          />
        ) : (
          <CourseCover course={open} className="mb-4 aspect-video w-full rounded-xl object-cover" />
        )}
        <h3 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
          {open.title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          {open.blurb}
        </p>

        <div className="mt-4 flex flex-col">
          {open.lessons.map((l, i) => (
            <button
              key={l.id}
              type="button"
              disabled={!l.videoUrl}
              onClick={() => setPlaying(l)}
              aria-current={playing?.id === l.id ? "true" : undefined}
              className="flex w-full items-center gap-3 border-b py-2.5 text-start last:border-0 enabled:hover:bg-white/[0.03]"
              style={{
                borderColor: "var(--vg-border-subtle)",
                background: playing?.id === l.id ? "var(--vg-primary-a14)" : undefined,
              }}
            >
              <span className="vg-numeric w-5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
                {n(i + 1)}
              </span>
              {/* A lesson with no video yet is listed and greyed, not
                      hidden — the syllabus is the promise, and hiding the gap
                      hides it from us too. */}
              {l.videoUrl ? (
                <Play size={13} weight="fill" style={{ color: "var(--vg-primary-soft)" }} />
              ) : (
                <Lock size={13} style={{ color: "var(--vg-text-faint)" }} />
              )}
              <span className="flex-1 text-[13px]" style={{ color: l.videoUrl ? "var(--vg-text)" : "var(--vg-text-muted)" }}>
                {l.title}
              </span>
              <span className="vg-numeric text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
                {mmss(l.seconds)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            disabled={!first}
            onClick={() => first && setPlaying(first)}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold disabled:opacity-50"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <Play size={14} weight="fill" />
            شروع دوره
          </button>
          {open.familyId && (
            <button
              onClick={() => onOpenModel(open.familyId!)}
              className="h-11 rounded-xl px-4 text-[12.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
            >
              رفتن به مدل
            </button>
          )}
        </div>
        {!first && (
          <p className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            ویدیوها هنوز آپلود نشده‌اند — این فهرست درس‌هاست.
          </p>
        )}
      </div>
    </div>
  );
}
