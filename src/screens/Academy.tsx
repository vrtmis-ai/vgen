import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Lock, Clock } from "@phosphor-icons/react";
import { COURSES, LEVEL_LABEL, courseMinutes, type Course } from "../data/academy";
import { published } from "../data/content";
import { CoinMark } from "../components/chrome";
import { useI18n } from "../lib/i18n";

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
        <img src={art(c.seed)} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100" style={{ background: "rgba(0,0,0,0.35)" }}>
          <span className="grid size-11 place-items-center rounded-full" style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}>
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
        <span className="rounded-md px-1.5 py-0.5 text-[10.5px]" style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}>
          {LEVEL_LABEL[c.level]}
        </span>
        {/* text-muted, not text-faint: faint is for placeholder and disabled,
            and at 11px it measures 3.31:1 — below AA for real content. */}
        <span className="vg-numeric text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
          {n(c.lessons.length)} درس
        </span>
        <span className="ms-auto flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: c.coins ? "var(--vg-text)" : "var(--vg-primary-soft)" }}>
          {c.coins ? (
            <>
              <CoinMark size={11} />
              <span className="vg-numeric">{n(c.coins)}</span>
            </>
          ) : (
            "رایگان"
          )}
        </span>
      </div>
    </button>
  );
}

export default function Academy({ onOpenModel }: { onOpenModel: (familyId: string, prompt?: string) => void }) {
  const { n } = useI18n();
  const courses = published(COURSES);
  const [open, setOpen] = useState<Course | null>(null);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[1000px] px-4 pb-20 pt-6">
      {/* The hero: a single wide card, headline split accent/white. */}
      <div className="relative overflow-hidden rounded-2xl" style={{ background: "var(--vg-surface)" }}>
        <img src={art("vgen-academy-hero", 1400, 620)} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.35) 70%)" }} />
        <div className="relative flex min-h-[300px] flex-col justify-end p-7 md:p-10">
          <p className="mb-2 text-[13px] font-bold" style={{ color: "var(--vg-text-secondary)" }}>
            آکادمی VGen
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

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" style={{ background: "rgba(9,9,9,0.9)" }} onClick={() => setOpen(null)}>
          <div
            className="max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={art(open.seed)} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />
            <h3 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
              {open.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
              {open.blurb}
            </p>

            <div className="mt-4 flex flex-col">
              {open.lessons.map((l, i) => (
                <div key={l.id} className="flex items-center gap-3 border-b py-2.5 last:border-0" style={{ borderColor: "var(--vg-border-subtle)" }}>
                  <span className="vg-numeric w-5 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
                    {n(i + 1)}
                  </span>
                  {/* A lesson with no video yet is listed and greyed, not
                      hidden — the syllabus is the promise, and hiding the gap
                      hides it from us too. */}
                  {l.videoUrl ? <Play size={13} weight="fill" style={{ color: "var(--vg-primary-soft)" }} /> : <Lock size={13} style={{ color: "var(--vg-text-faint)" }} />}
                  <span className="flex-1 text-[13px]" style={{ color: l.videoUrl ? "var(--vg-text)" : "var(--vg-text-muted)" }}>
                    {l.title}
                  </span>
                  <span className="vg-numeric text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
                    {mmss(l.seconds)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold"
                style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
              >
                {open.coins ? (
                  <>
                    خرید دوره
                    <span className="flex items-center gap-1 text-[12px] opacity-90">
                      <CoinMark size={11} />
                      <span className="vg-numeric">{n(open.coins)}</span>
                    </span>
                  </>
                ) : (
                  "شروع رایگان"
                )}
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
            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              ویدیوها هنوز آپلود نشده‌اند — این فهرست درس‌هاست.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
