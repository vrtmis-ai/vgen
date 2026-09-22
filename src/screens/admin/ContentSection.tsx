import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminApi, AdminFamily } from "../../features/admin/adminApi";
import { BANK_LABEL, CATEGORY_LABEL, LEVEL_LABEL } from "../../features/content/labels";
import { courseArt, mediaSrc, placeholderArt, presetArt } from "../../features/content/media";
import { readDuration } from "../../components/controls";
import { ApiError } from "../../runtime/apiError";
import {
  CONTENT_MEDIA_LIMITS,
  type ContentEntry,
  type ContentMedia,
  type ContentMediaPurpose,
  type ContentWrite,
  type EditableContentKind,
} from "../../runtime/contracts/content";
import { Muted } from "./primitives";

/**
 * Effects, academy courses and the prompt bank.
 *
 * All three used to change only with a deploy: they are rows in
 * `content_items`, and the only thing that wrote those rows was the seed file.
 * This is the other writer. What is saved here is on the site as soon as it is
 * saved — the public document rebuilds when a published row changes.
 *
 * **Delete archives.** The seed runs on every deploy and would otherwise put a
 * deleted seeded row straight back; an archived one it leaves alone. From here
 * an archived row is simply gone.
 *
 * **Files go up when they are picked**, not when the form is saved, so a
 * 100MB lesson is not re-sent because a title had a typo. An upload the form
 * is then cancelled on is left in storage unreferenced — cheap, and never
 * served, since nothing links to it.
 */

type PresetWrite = Extract<ContentWrite, { kind: "preset" }>;
type CourseWrite = Extract<ContentWrite, { kind: "course" }>;
type FragmentWrite = Extract<ContentWrite, { kind: "prompt_fragment" }>;
type LessonDraft = CourseWrite["item"]["lessons"][number];

const TABS: { kind: EditableContentKind; label: string; add: string }[] = [
  { kind: "preset", label: "افکت‌ها", add: "افکت تازه" },
  { kind: "course", label: "دوره‌های آکادمی", add: "دوره‌ی تازه" },
  { kind: "prompt_fragment", label: "بانک پرامپت", add: "واژه‌ی تازه" },
];

const MB = 1024 * 1024;
const inputStyle = { background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" };
const inputClass = "w-full rounded-lg px-2.5 text-[12.5px]";

const newId = () => `l-${Math.random().toString(36).slice(2, 10)}`;

export function ContentSection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<EditableContentKind>("preset");
  const [search, setSearch] = useState("");
  // `seed` rides beside the write rather than in it: the server keeps a row's
  // seed, but the editor needs it to show the placeholder the site draws.
  const [editing, setEditing] = useState<{ id: string | null; write: ContentWrite; seed?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = useQuery({ queryKey: ["admin", "content", kind], queryFn: () => api.listContent(kind), retry: false });
  // Audio families cannot run an effect or anchor a course.
  const families = useQuery({ queryKey: ["admin", "families"], queryFn: () => api.listFamilies(), staleTime: 5 * 60_000, retry: false });
  const makable = (families.data ?? []).filter((family) => family.kind !== "audio");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "content", kind] });

  const save = useMutation({
    mutationFn: ({ id, write }: { id: string | null; write: ContentWrite }) =>
      id ? api.updateContent(id, write) : api.createContent(write),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await refresh();
    },
    onError: (failure) => setError(saveError(failure)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteContent(id), onSuccess: refresh });

  if (editing) {
    const frame = {
      busy: save.isPending,
      error,
      isNew: editing.id === null,
      onCancel: () => {
        setEditing(null);
        setError(null);
      },
      onSave: (write: ContentWrite) => save.mutate({ id: editing.id, write }),
    };
    const initial = editing.write;
    if (initial.kind === "preset") return <PresetEditor api={api} families={makable} initial={initial} seed={editing.seed} {...frame} />;
    if (initial.kind === "course") return <CourseEditor api={api} families={makable} initial={initial} seed={editing.seed} {...frame} />;
    return <FragmentEditor initial={initial} {...frame} />;
  }

  const tab = TABS.find((candidate) => candidate.kind === kind)!;
  const needle = search.trim().toLowerCase();
  const shown = (entries.data ?? []).filter((entry) => !needle || searchText(entry).toLowerCase().includes(needle));
  const familyName = (id: string | undefined) => makable.find((family) => family.id === id)?.name ?? id ?? "—";

  return (
    <div>
      <p className="mb-3 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
        هر چه اینجا ذخیره شود همان لحظه روی سایت است. پیش‌نویس‌ها فقط همین‌جا دیده می‌شوند. حذف، مورد را از سایت و از این فهرست برمی‌دارد.
      </p>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="نوع محتوا">
        {TABS.map((candidate) => (
          <button
            key={candidate.kind}
            role="tab"
            aria-selected={candidate.kind === kind}
            onClick={() => {
              setKind(candidate.kind);
              setSearch("");
            }}
            className="h-8 rounded-lg px-3 text-[12.5px] font-semibold"
            style={{
              background: candidate.kind === kind ? "var(--vg-primary-a18)" : "var(--vg-surface)",
              color: candidate.kind === kind ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
              border: "1px solid var(--vg-border-subtle)",
            }}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`جستجو در ${tab.label}…`}
          aria-label={`جستجو در ${tab.label}`}
          className={`${inputClass} h-9 max-w-[320px]`}
          style={inputStyle}
        />
        {canWrite ? (
          <button
            onClick={() => {
              setError(null);
              setEditing({ id: null, write: blank(kind, makable) });
            }}
            className="ms-auto h-9 rounded-lg px-3 text-[12.5px] font-bold"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            + {tab.add}
          </button>
        ) : null}
      </div>

      {entries.isPending ? <Muted>در حال خواندن…</Muted> : null}
      {entries.error ? <Muted>فهرست خوانده نشد.</Muted> : null}
      {entries.data && shown.length === 0 ? <Muted>{needle ? "چیزی پیدا نشد." : "هنوز چیزی اینجا نیست."}</Muted> : null}
      {remove.error ? <Muted>حذف نشد؛ دوباره تلاش کن.</Muted> : null}

      <div className="mt-3 flex flex-col gap-2">
        {shown.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 rounded-xl p-2"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <Thumb entry={entry} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
                {titleOf(entry)}
              </div>
              <div className="truncate text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
                {entry.kind === "preset"
                  ? `${familyName(entry.item.familyId)} · ${CATEGORY_LABEL[entry.item.category]}`
                  : entry.kind === "course"
                    ? `${LEVEL_LABEL[entry.item.level]} · ${entry.item.lessons.length} درس · ${entry.item.lessons.filter((lesson) => lesson.videoUrl).length} ویدیو`
                    : `${BANK_LABEL[entry.item.category]} · ${entry.item.fragment}`}
              </div>
            </div>
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]"
              style={{
                background: entry.status === "published" ? "var(--vg-primary-a14)" : "var(--vg-surface-overlay)",
                color: entry.status === "published" ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
              }}
            >
              {entry.status === "published" ? "روی سایت" : "پیش‌نویس"}
            </span>
            {canWrite ? (
              <>
                <button
                  onClick={() => {
                    setError(null);
                    setEditing({
                      id: entry.id,
                      write: toWrite(entry),
                      ...(entry.kind === "prompt_fragment" ? {} : { seed: entry.item.seed }),
                    });
                  }}
                  aria-label={`ویرایش ${titleOf(entry)}`}
                  className="h-8 shrink-0 rounded-lg px-2.5 text-[12px]"
                  style={inputStyle}
                >
                  ویرایش
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`«${titleOf(entry)}» از سایت حذف شود؟`)) remove.mutate(entry.id);
                  }}
                  disabled={remove.isPending}
                  aria-label={`حذف ${titleOf(entry)}`}
                  className="h-8 shrink-0 rounded-lg px-2.5 text-[12px]"
                  style={{ ...inputStyle, color: "var(--vg-danger, #ff6c52)" }}
                >
                  حذف
                </button>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -- the three editors ------------------------------------------------------- */

interface FrameProps {
  busy: boolean;
  error: string | null;
  isNew: boolean;
  onCancel: () => void;
  onSave: (write: ContentWrite) => void;
}

function PresetEditor({
  api,
  families,
  initial,
  seed,
  ...frame
}: FrameProps & { api: AdminApi; families: AdminFamily[]; initial: PresetWrite; seed?: string | undefined }) {
  const [draft, setDraft] = useState(initial);
  const item = draft.item;
  const set = (patch: Partial<PresetWrite["item"]>) => setDraft((previous) => ({ ...previous, item: { ...previous.item, ...patch } }));

  return (
    <EditorFrame
      title={frame.isNew ? "افکت تازه" : "ویرایش افکت"}
      status={draft.status}
      onStatus={(status) => setDraft((previous) => ({ ...previous, status }))}
      canSave={Boolean(item.title.trim() && item.prompt.trim() && item.familyId)}
      {...frame}
      onSave={() => frame.onSave(draft)}
    >
      <Field label="عنوان">
        <input
          value={item.title}
          onChange={(event) => set({ title: event.target.value })}
          maxLength={120}
          aria-label="عنوان"
          className={`${inputClass} h-9`}
          style={inputStyle}
        />
      </Field>
      <Field label="مدل">
        <FamilySelect
          families={families}
          value={item.familyId}
          onChange={(family) => set(family ? { familyId: family.id, kind: family.kind === "image" ? "image" : "video" } : { familyId: "" })}
        />
      </Field>
      <Field label="پرامپت" hint="همان متنی که به مدل می‌رود؛ معمولاً انگلیسی." wide>
        <textarea
          value={item.prompt}
          onChange={(event) => set({ prompt: event.target.value })}
          maxLength={4000}
          rows={5}
          dir="ltr"
          aria-label="پرامپت"
          className={`${inputClass} py-2 leading-5`}
          style={inputStyle}
        />
      </Field>
      <Field label="دسته">
        <select
          value={item.category}
          onChange={(event) => set({ category: event.target.value as PresetWrite["item"]["category"] })}
          aria-label="دسته"
          className={`${inputClass} h-9`}
          style={inputStyle}
        >
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="برچسب (اختیاری)" hint="مثلاً «جدید» — گوشه‌ی کارت می‌نشیند.">
        <input
          value={item.badge ?? ""}
          onChange={(event) => set({ badge: event.target.value || undefined })}
          maxLength={24}
          aria-label="برچسب"
          className={`${inputClass} h-9`}
          style={inputStyle}
        />
      </Field>
      <Check
        label="کاربر سوژه‌ی خودش را به آخر پرامپت اضافه می‌کند"
        checked={item.openEnded}
        onChange={(openEnded) => set({ openEnded })}
      />
      <MediaField
        api={api}
        label="تصویر کاور"
        hint={`JPEG، PNG، WebP یا GIF، حداکثر ${CONTENT_MEDIA_LIMITS.image / MB} مگابایت. قاب کارت ۳ به ۴ است.`}
        purpose="cover"
        accept="image/jpeg,image/png,image/webp,image/gif"
        value={item.coverUrl ? { url: item.coverUrl, kind: "image" } : undefined}
        fallback={seed ? placeholderArt(seed, 480, 640) : undefined}
        onChange={(media) => set({ coverUrl: media?.url })}
      />
    </EditorFrame>
  );
}

function CourseEditor({
  api,
  families,
  initial,
  seed,
  ...frame
}: FrameProps & { api: AdminApi; families: AdminFamily[]; initial: CourseWrite; seed?: string | undefined }) {
  const [draft, setDraft] = useState(initial);
  const item = draft.item;
  const set = (patch: Partial<CourseWrite["item"]>) => setDraft((previous) => ({ ...previous, item: { ...previous.item, ...patch } }));
  // Functional all the way down: a lesson's length arrives after its file is
  // read, by which time the draft may have moved on.
  const setLessons = (change: (lessons: LessonDraft[]) => LessonDraft[]) =>
    setDraft((previous) => ({ ...previous, item: { ...previous.item, lessons: change(previous.item.lessons) } }));
  const patchLesson = (id: string, patch: Partial<LessonDraft>) =>
    setLessons((lessons) => lessons.map((lesson) => (lesson.id === id ? { ...lesson, ...patch } : lesson)));
  const move = (index: number, by: -1 | 1) =>
    setLessons((lessons) => {
      const next = [...lessons];
      const [taken] = next.splice(index, 1);
      next.splice(index + by, 0, taken!);
      return next;
    });

  const lessonsReady = item.lessons.length > 0 && item.lessons.every((lesson) => lesson.title.trim() && lesson.seconds >= 1);

  return (
    <EditorFrame
      title={frame.isNew ? "دوره‌ی تازه" : "ویرایش دوره"}
      status={draft.status}
      onStatus={(status) => setDraft((previous) => ({ ...previous, status }))}
      canSave={Boolean(item.title.trim() && item.blurb.trim() && lessonsReady)}
      {...frame}
      onSave={() => frame.onSave(draft)}
    >
      <Field label="عنوان">
        <input
          value={item.title}
          onChange={(event) => set({ title: event.target.value })}
          maxLength={120}
          aria-label="عنوان"
          className={`${inputClass} h-9`}
          style={inputStyle}
        />
      </Field>
      <Field label="سطح">
        <select
          value={item.level}
          onChange={(event) => set({ level: event.target.value as CourseWrite["item"]["level"] })}
          aria-label="سطح"
          className={`${inputClass} h-9`}
          style={inputStyle}
        >
          {Object.entries(LEVEL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="توضیح کوتاه" wide>
        <textarea
          value={item.blurb}
          onChange={(event) => set({ blurb: event.target.value })}
          maxLength={600}
          rows={3}
          aria-label="توضیح کوتاه"
          className={`${inputClass} py-2 leading-6`}
          style={inputStyle}
        />
      </Field>
      <Field label="مدل مرتبط (اختیاری)" hint="دکمه‌ی «رفتن به مدل» در صفحه‌ی دوره.">
        <FamilySelect families={families} value={item.familyId ?? ""} optional onChange={(family) => set({ familyId: family?.id })} />
      </Field>
      <MediaField
        api={api}
        label="کاور"
        hint={`تصویر تا ${CONTENT_MEDIA_LIMITS.image / MB} مگابایت، یا ویدیوی کوتاه MP4/WebM تا ${CONTENT_MEDIA_LIMITS.coverVideo / MB} مگابایت که بی‌صدا تکرار می‌شود. قاب ۱۶ به ۹ است.`}
        purpose="cover"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
        value={item.cover}
        fallback={seed ? placeholderArt(seed, 800, 450) : undefined}
        onChange={(media) => set({ cover: media ? { url: media.url, kind: media.kind } : undefined })}
      />

      <div className="sm:col-span-2">
        <div className="mb-1.5 text-[11.5px] font-semibold" style={{ color: "var(--vg-text-muted)" }}>
          درس‌ها
        </div>
        <div className="flex flex-col gap-2">
          {item.lessons.map((lesson, index) => (
            <div key={lesson.id} className="rounded-xl p-2.5" style={{ border: "1px solid var(--vg-border-subtle)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-[12px] tabular-nums" style={{ color: "var(--vg-text-faint)" }}>
                  {index + 1}
                </span>
                <input
                  value={lesson.title}
                  onChange={(event) => patchLesson(lesson.id, { title: event.target.value })}
                  maxLength={160}
                  placeholder="عنوان درس"
                  aria-label={`عنوان درس ${index + 1}`}
                  className={`${inputClass} h-9 min-w-[180px] flex-1`}
                  style={inputStyle}
                />
                <input
                  type="number"
                  min={1}
                  value={lesson.seconds}
                  onChange={(event) => patchLesson(lesson.id, { seconds: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                  aria-label={`مدت درس ${index + 1} به ثانیه`}
                  title="مدت به ثانیه — با انتخاب ویدیو خودکار پر می‌شود"
                  dir="ltr"
                  className={`${inputClass} h-9 w-24`}
                  style={inputStyle}
                />
                <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                  ثانیه
                </span>
                <SmallButton label={`بالا بردن درس ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </SmallButton>
                <SmallButton
                  label={`پایین بردن درس ${index + 1}`}
                  disabled={index === item.lessons.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </SmallButton>
                <SmallButton
                  label={`حذف درس ${index + 1}`}
                  disabled={item.lessons.length === 1}
                  onClick={() => setLessons((lessons) => lessons.filter((candidate) => candidate.id !== lesson.id))}
                >
                  ✕
                </SmallButton>
              </div>
              <MediaField
                api={api}
                label="ویدیوی درس"
                hint={`MP4 یا WebM، حداکثر ${CONTENT_MEDIA_LIMITS.lessonVideo / MB} مگابایت (حدود ده دقیقه 720p). بدون ویدیو، درس در فهرست قفل نشان داده می‌شود.`}
                purpose="lesson"
                accept="video/mp4,video/webm"
                value={lesson.videoUrl ? { url: lesson.videoUrl, kind: "video" } : undefined}
                onChange={(media) => {
                  patchLesson(lesson.id, { videoUrl: media?.url });
                  // Read from the stored copy rather than the picked file: it
                  // is the one visitors will play, and its length is the one
                  // the syllabus should print.
                  if (media) {
                    void readDuration(mediaSrc(media.url), "video").then((seconds) => {
                      if (seconds) patchLesson(lesson.id, { seconds: Math.max(1, Math.round(seconds)) });
                    });
                  }
                }}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLessons((lessons) => [...lessons, { id: newId(), title: "", seconds: 60 }])}
          disabled={item.lessons.length >= 100}
          className="mt-2 h-8 rounded-lg px-3 text-[12px]"
          style={inputStyle}
        >
          + درس
        </button>
      </div>
    </EditorFrame>
  );
}

function FragmentEditor({ initial, ...frame }: FrameProps & { initial: FragmentWrite }) {
  const [draft, setDraft] = useState(initial);
  const item = draft.item;
  const set = (patch: Partial<FragmentWrite["item"]>) => setDraft((previous) => ({ ...previous, item: { ...previous.item, ...patch } }));

  return (
    <EditorFrame
      title={frame.isNew ? "واژه‌ی تازه برای بانک پرامپت" : "ویرایش واژه"}
      status={draft.status}
      onStatus={(status) => setDraft((previous) => ({ ...previous, status }))}
      canSave={Boolean(item.label.trim() && item.fragment.trim() && item.note.trim())}
      {...frame}
      onSave={() => frame.onSave(draft)}
    >
      <Field label="نام فارسی">
        <input
          value={item.label}
          onChange={(event) => set({ label: event.target.value })}
          maxLength={80}
          aria-label="نام فارسی"
          className={`${inputClass} h-9`}
          style={inputStyle}
        />
      </Field>
      <Field label="دسته">
        <select
          value={item.category}
          onChange={(event) => set({ category: event.target.value as FragmentWrite["item"]["category"] })}
          aria-label="دسته"
          className={`${inputClass} h-9`}
          style={inputStyle}
        >
          {Object.entries(BANK_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="متن انگلیسی" hint="همان تکه‌ای که کاربر کپی می‌کند و به پرامپتش می‌چسباند." wide>
        <textarea
          value={item.fragment}
          onChange={(event) => set({ fragment: event.target.value })}
          maxLength={400}
          rows={2}
          dir="ltr"
          aria-label="متن انگلیسی"
          className={`${inputClass} py-2 leading-5`}
          style={inputStyle}
        />
      </Field>
      <Field label="توضیح" wide>
        <textarea
          value={item.note}
          onChange={(event) => set({ note: event.target.value })}
          maxLength={300}
          rows={2}
          aria-label="توضیح"
          className={`${inputClass} py-2 leading-6`}
          style={inputStyle}
        />
      </Field>
    </EditorFrame>
  );
}

/* -- pieces ------------------------------------------------------------------ */

function EditorFrame({
  title,
  status,
  onStatus,
  canSave,
  busy,
  error,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  status: ContentWrite["status"];
  onStatus: (status: ContentWrite["status"]) => void;
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !busy) onSave();
      }}
      className="rounded-2xl p-4"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <h2 className="mb-3 text-[15px] font-extrabold" style={{ color: "var(--vg-text)" }}>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--vg-border-subtle)" }}>
        <Check label="روی سایت نشان داده شود" checked={status === "published"} onChange={(on) => onStatus(on ? "published" : "draft")} />
        <button
          type="button"
          onClick={onCancel}
          className="ms-auto h-9 rounded-lg px-3 text-[12.5px]"
          style={{ background: "transparent", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
        >
          انصراف
        </button>
        <button
          type="submit"
          disabled={!canSave || busy}
          className="h-9 rounded-lg px-4 text-[12.5px] font-bold disabled:opacity-50"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          {busy ? "در حال ذخیره…" : "ذخیره"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Field({ label, hint, wide = false, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="mb-1 text-[11.5px] font-semibold" style={{ color: "var(--vg-text-muted)" }}>
        {label}
      </div>
      {children}
      {hint ? (
        <div className="mt-1 text-[10.5px] leading-4" style={{ color: "var(--vg-text-faint)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--vg-text)" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function SmallButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-[13px] disabled:opacity-30"
      style={inputStyle}
    >
      {children}
    </button>
  );
}

/**
 * The families a card can open. A row saved against a family that has since
 * been switched off keeps it listed, marked, rather than silently showing the
 * first option and saving that instead.
 */
function FamilySelect({
  families,
  value,
  optional = false,
  onChange,
}: {
  families: AdminFamily[];
  value: string;
  optional?: boolean;
  onChange: (family: AdminFamily | undefined) => void;
}) {
  const known = families.some((family) => family.id === value);
  return (
    <select
      value={value}
      onChange={(event) => onChange(families.find((family) => family.id === event.target.value))}
      aria-label="مدل"
      className={`${inputClass} h-9`}
      style={inputStyle}
    >
      <option value="">{optional ? "بدون مدل" : "انتخاب مدل…"}</option>
      {value && !known ? <option value={value}>{value} (غیرفعال)</option> : null}
      {families.map((family) => (
        <option key={family.id} value={family.id}>
          {family.name} — {family.kind === "image" ? "تصویر" : "ویدیو"}
        </option>
      ))}
    </select>
  );
}

function MediaField({
  api,
  label,
  hint,
  purpose,
  accept,
  value,
  fallback,
  onChange,
}: {
  api: AdminApi;
  label: string;
  hint: string;
  purpose: ContentMediaPurpose;
  accept: string;
  value: { url: string; kind: "image" | "video" } | undefined;
  /** What the site shows while there is no upload: the seeded rows' placeholder art. */
  fallback?: string | undefined;
  onChange: (media: ContentMedia | undefined) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    // A drop skips the picker's `accept`, so the type is checked here too.
    if (!accept.split(",").includes(file.type)) {
      setError(purpose === "lesson" ? "درس باید ویدیوی MP4 یا WebM باشد." : "این نوع فایل اینجا پذیرفته نیست.");
      return;
    }
    // Checked here as well as on the server so a 300MB mistake is refused
    // before it spends ten minutes uploading.
    const video = file.type.startsWith("video/");
    const limit = video
      ? purpose === "lesson"
        ? CONTENT_MEDIA_LIMITS.lessonVideo
        : CONTENT_MEDIA_LIMITS.coverVideo
      : CONTENT_MEDIA_LIMITS.image;
    if (file.size > limit) {
      setError(`این فایل ${Math.ceil(file.size / MB)} مگابایت است؛ سقف ${limit / MB} مگابایت است.`);
      return;
    }
    setBusy(true);
    try {
      onChange(await api.uploadContentMedia(file, purpose));
    } catch (failure) {
      setError(uploadError(failure));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Field label={label} hint={hint} wide={purpose === "lesson"}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
        data-dropzone
        className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2 transition-colors"
        style={{
          borderColor: over ? "var(--vg-primary)" : "var(--vg-border)",
          background: over ? "var(--vg-primary-a14)" : "transparent",
        }}
      >
        {value ? (
          value.kind === "video" ? (
            <video src={mediaSrc(value.url)} muted controls preload="metadata" className="h-20 max-w-[180px] rounded-lg bg-black" />
          ) : (
            <img src={mediaSrc(value.url)} alt="" className="h-20 max-w-[180px] rounded-lg object-cover" />
          )
        ) : fallback ? (
          <span className="relative">
            <img src={fallback} alt="" className="h-20 max-w-[180px] rounded-lg object-cover" />
            <PlaceholderTag />
          </span>
        ) : null}
        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-[12px]" style={inputStyle}>
          <input
            ref={input}
            type="file"
            accept={accept}
            disabled={busy}
            aria-label={label}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {busy ? "در حال آپلود…" : value || fallback ? "جایگزینی فایل" : "انتخاب فایل"}
        </label>
        <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
          {over ? "رها کن تا آپلود شود" : "یا فایل را اینجا بکش و رها کن"}
        </span>
        {value && !busy ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="h-9 rounded-lg px-3 text-[12px]"
            style={{ ...inputStyle, color: "var(--vg-text-muted)" }}
          >
            برداشتن
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          {error}
        </p>
      ) : null}
    </Field>
  );
}

/**
 * The picture the site shows for this row — the same function the public
 * pages call, so the panel cannot disagree with them. A row nobody has
 * uploaded a cover for still has one on the site (placeholder art drawn from
 * its seed), and saying "no cover" here while the site shows a photo read as
 * the panel failing to load it.
 */
function Thumb({ entry }: { entry: ContentEntry }) {
  const box = "size-12 rounded-lg object-cover";
  if (entry.kind === "prompt_fragment") return null;
  const uploaded = entry.kind === "preset" ? Boolean(entry.item.coverUrl) : Boolean(entry.item.cover);
  return (
    <span className="relative shrink-0">
      {entry.kind === "course" && entry.item.cover?.kind === "video" ? (
        <video src={mediaSrc(entry.item.cover.url)} muted preload="metadata" className={`${box} bg-black`} />
      ) : (
        <img src={entry.kind === "preset" ? presetArt(entry.item, 96, 128) : courseArt(entry.item, 160, 90)} alt="" className={box} />
      )}
      {uploaded ? null : <PlaceholderTag />}
    </span>
  );
}

/** Marks placeholder art: on the site today, but a stock photo until a cover is uploaded. */
function PlaceholderTag() {
  return (
    <span
      className="absolute inset-x-0 bottom-0 rounded-b-lg py-px text-center text-[8.5px] leading-3"
      style={{ background: "rgba(0,0,0,0.65)", color: "var(--vg-text-secondary)" }}
      title="تصویر موقت سایت؛ با آپلود کاور جایگزین می‌شود"
    >
      موقت
    </span>
  );
}

/* -- helpers ----------------------------------------------------------------- */

function titleOf(entry: ContentEntry): string {
  return entry.kind === "prompt_fragment" ? entry.item.label : entry.item.title;
}

function searchText(entry: ContentEntry): string {
  if (entry.kind === "preset") return `${entry.item.title} ${entry.item.prompt}`;
  if (entry.kind === "course")
    return `${entry.item.title} ${entry.item.blurb} ${entry.item.lessons.map((lesson) => lesson.title).join(" ")}`;
  return `${entry.item.label} ${entry.item.fragment} ${entry.item.note}`;
}

function toWrite(entry: ContentEntry): ContentWrite {
  if (entry.kind === "preset") {
    const { id, seed, ...item } = entry.item;
    return { kind: "preset", status: entry.status, item };
  }
  if (entry.kind === "course") {
    const { id, seed, ...item } = entry.item;
    return { kind: "course", status: entry.status, item };
  }
  const { id, ...item } = entry.item;
  return { kind: "prompt_fragment", status: entry.status, item };
}

function blank(kind: EditableContentKind, families: AdminFamily[]): ContentWrite {
  if (kind === "preset") {
    const family = families.find((candidate) => candidate.kind === "video") ?? families[0];
    return {
      kind: "preset",
      status: "published",
      item: {
        title: "",
        prompt: "",
        familyId: family?.id ?? "",
        openEnded: false,
        kind: family?.kind === "image" ? "image" : "video",
        category: "vfx",
      },
    };
  }
  if (kind === "course") {
    return {
      kind: "course",
      status: "published",
      item: { title: "", blurb: "", level: "beginner", lessons: [{ id: newId(), title: "", seconds: 60 }] },
    };
  }
  return { kind: "prompt_fragment", status: "published", item: { label: "", fragment: "", category: "camera", note: "" } };
}

function uploadError(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.code === "file_too_large" || failure.code === "payload_too_large" || failure.status === 413)
      return "فایل از سقف مجاز بزرگ‌تر است.";
    if (failure.code === "unsupported_media_type") return "این نوع فایل پذیرفته نیست. تصویر JPEG/PNG/WebP/GIF یا ویدیوی MP4/WebM بفرست.";
    // The admin surface answers 404 to an expired staff session, by design.
    if (failure.status === 401 || failure.status === 403 || failure.status === 404) return "نشست پنل تمام شده؛ دوباره وارد شو.";
    if (failure.status >= 500) return "سرور نتوانست فایل را ذخیره کند؛ دوباره تلاش کن و اگر تکرار شد خبر بده.";
  }
  return "آپلود نشد؛ اتصال را بررسی کن و دوباره تلاش کن.";
}

function saveError(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.code === "unknown_family") return "این مدل دیگر فعال نیست؛ مدل دیگری انتخاب کن.";
    if (failure.code === "validation_failed") return "چند فیلد درست پر نشده‌اند.";
    if (failure.code === "not_found") return "این مورد در این فاصله حذف شده است.";
    if (failure.status === 401 || failure.status === 403) return "نشست تمام شده یا اجازه‌ی ویرایش نداری.";
  }
  return "ذخیره نشد؛ دوباره تلاش کن.";
}
