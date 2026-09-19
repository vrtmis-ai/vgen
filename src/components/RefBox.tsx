import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, X, FilmSlate, MusicNote, DotsThree, Check } from "@phosphor-icons/react";
import type { RefSlot, SlotMedia } from "../data/models";
import { addRefFiles, moveRefFile, type RefFile, type RefMap } from "./controls";
import { dependenciesMet, groupOf, kindOfFile, landingSlot, roleWord, slotsForKind } from "../lib/refSlots";
import { refTags, tagUsed } from "../lib/refTags";
import { useFloatingDismiss, useFloatingPosition } from "./FloatingSurface";
import { faNum } from "../lib/format";

/* ---------------------------------------------------------------------------
   One box for everything the model takes.

   The dock drew a labelled upload area per slot. On Seedance 2.5 that is three
   of them — image, video, audio — stacked down a 342px column, and together
   they were taller than the prompt, the model row, the duration and the
   settings combined. None of it asked a question the customer could answer
   better than the file could: a file already knows whether it is a picture or
   a clip, and `kindOfFile` reads it off the MIME type.

   So: one box, anything goes in, and `landingSlot` decides which of the
   model's slots it belongs to. The only question left is the one the file
   cannot answer — whether a picture is material to draw from or the first or
   last frame of the clip — and that is asked per file, on the tile, and only
   on models that have frames to give. Seedance has none: its API takes
   reference_image_urls and has no first_frame_url at all, so there the menu
   offers order and removal and nothing else.

   A tile that has been given a part wears the word, the way Higgsfield labels
   its start and end frames.
   --------------------------------------------------------------------------- */

const ACCEPT: Record<SlotMedia, string> = {
  image: "image/*",
  video: "video/mp4,video/quicktime,video/x-matroska",
  audio: "audio/mpeg,audio/wav",
};

const KIND_WORD: Record<SlotMedia, string> = { image: "تصویر", video: "ویدیو", audio: "صدا" };

/** The drag's own MIME type. `Files` is what an OS drag carries, and the box
 *  has to tell the two apart: one adds, the other rearranges. */
const DRAG_TYPE = "application/x-deev-ref";

interface Tile {
  slot: RefSlot;
  index: number;
  file: RefFile;
}

/** Files in catalogue slot order, so the row does not reshuffle on every move. */
function tilesOf(slots: RefSlot[], refs: RefMap): Tile[] {
  return slots.flatMap((slot) => (refs[slot.key] ?? []).map((file, index) => ({ slot, index, file })));
}

const counts = (refs: RefMap): Record<string, number> =>
  Object.fromEntries(Object.entries(refs).map(([key, files]) => [key, files.length]));

/**
 * What the slots would hold after moving one file from `fromKey` to `toKey`.
 *
 * A target that is already full and holds one file *swaps* rather than
 * refusing — the two frames trade places, which is what somebody who put them
 * in the wrong order means. So the source does not always empty, and whether
 * it does is the thing a dependency check has to know.
 */
function countsAfterMove(slots: RefSlot[], refs: RefMap, fromKey: string, toKey: string): Record<string, number> {
  const after = counts(refs);
  const target = slots.find((slot) => slot.key === toKey);
  if (!target) return after;
  const held = after[toKey] ?? 0;
  const swaps = held >= target.max;
  after[fromKey] = (after[fromKey] ?? 0) - 1 + (swaps ? held : 0);
  after[toKey] = swaps ? 1 : held + 1;
  return after;
}

interface MenuItem {
  key: string;
  label: string;
  checked?: boolean;
  danger?: boolean;
  run: () => void;
}

/**
 * The tile's own menu.
 *
 * A menu rather than `PopoverMenu`, which is a listbox: these are not one
 * value with several settings, they are a part to give plus two rearrangements
 * plus a removal. Announcing them as options of a select would be a lie to
 * anybody listening.
 *
 * The reorder items are not garnish. Dragging is a pointer gesture with no
 * keyboard or touch equivalent, and WCAG 2.2 asks that it never be the only
 * way to do something — so everything the drag does, this does too.
 */
function TileMenu({ anchor, items, onClose }: { anchor: HTMLElement | null; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useFloatingPosition(anchor, ref, String(items.length));
  useFloatingDismiss({ anchor, surfaceRef: ref, onClose });

  useLayoutEffect(() => {
    const entries = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? []);
    (entries.find((entry) => entry.getAttribute("aria-checked") === "true") ?? entries[0])?.focus({ preventScroll: true });
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']") ?? []);
    if (!entries.length) return;
    const current = Math.max(0, entries.indexOf(document.activeElement as HTMLButtonElement));
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % entries.length;
    if (event.key === "ArrowUp") next = (current - 1 + entries.length) % entries.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = entries.length - 1;
    if (event.key === "Escape") onClose();
    if (next === null) return;
    event.preventDefault();
    entries[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={moveFocus}
      className="hide-scrollbar fixed z-[80] max-h-72 min-w-[168px] overflow-y-auto rounded-xl p-1"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        background: "var(--vg-surface-raised)",
        border: "1px solid var(--vg-border)",
        boxShadow: "0 16px 44px rgba(0,0,0,0.62)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          onClick={() => {
            item.run();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] transition-colors hover:bg-white/5"
          style={{ color: item.danger ? "var(--vg-danger)" : item.checked ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
        >
          <span className="flex-1 truncate">{item.label}</span>
          {item.checked && <Check size={12} weight="bold" />}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function TileMedia({ file, media }: { file: RefFile; media: SlotMedia }) {
  if (media === "video")
    return <video src={file.url} muted playsInline preload="metadata" className="vg-tile__media size-full object-cover" />;
  if (media === "audio")
    return (
      <span className="vg-tile__media grid size-full place-items-center" style={{ color: "var(--vg-text-faint)" }}>
        <MusicNote size={20} />
      </span>
    );
  return <img src={file.url} alt="" className="vg-tile__media size-full object-cover" />;
}

export function RefBox({
  slots,
  refs,
  onChange,
  prompt,
  onInsertTag,
}: {
  slots: RefSlot[];
  refs: RefMap;
  onChange: (next: RefMap) => void;
  /** Read only to show which references the prompt already points at. */
  prompt: string;
  onInsertTag: (tag: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const [menuAt, setMenuAt] = useState<{ at: number; anchor: HTMLElement } | null>(null);

  const tiles = tilesOf(slots, refs);
  const tags = refTags(slots, counts(refs));
  const kinds = [...new Set(slots.map((slot) => slot.media ?? "image"))];
  const accept = [...new Set(kinds.map((kind) => ACCEPT[kind]))].join(",");
  const room = slots.some((slot) => (refs[slot.key] ?? []).length < slot.max);

  async function add(picked: File[]) {
    let next = refs;
    let why: string | null = null;
    // Sequential, not `Promise.all`: each file changes which slots still have
    // room, so the second one has to be placed against the first one's result.
    for (const file of picked) {
      const kind = kindOfFile(file.type);
      const slot = kind ? landingSlot(slots, kind, counts(next)) : null;
      if (!kind || !slot) {
        why = kind && slotsForKind(slots, kind).length ? "جا برای این فایل نمانده" : "این مدل این نوع فایل را نمی‌گیرد";
        continue;
      }
      const result = await addRefFiles(slot, next[slot.key] ?? [], [file]);
      if (result.rejected) why = `فایل بزرگ‌تر از ${result.rejected} رد شد`;
      next = { ...next, [slot.key]: result.files };
    }
    setRejected(why);
    onChange(next);
  }

  function remove(key: string, index: number) {
    const file = (refs[key] ?? [])[index];
    if (file) URL.revokeObjectURL(file.url);
    setRejected(null);
    onChange({ ...refs, [key]: (refs[key] ?? []).filter((_, i) => i !== index) });
  }

  /** Give one file a different part. A full single-file target swaps with it. */
  function assign(tile: Tile, toKey: string) {
    if (tile.slot.key === toKey) return;
    const target = slots.find((slot) => slot.key === toKey);
    if (!target) return;
    const source = (refs[tile.slot.key] ?? []).filter((_, i) => i !== tile.index);
    const held = refs[toKey] ?? [];
    const full = held.length >= target.max;
    onChange({
      ...refs,
      [tile.slot.key]: full ? [...source, ...held] : source,
      [toKey]: full ? [tile.file] : [...held, tile.file],
    });
  }

  /**
   * Rearrange: the tile at `from` takes the place of the one at `to`.
   *
   * Inside one slot that is a reorder of its list. Across two slots it is a
   * straight exchange, which is why no dependency check is needed here — a
   * swap leaves every slot holding exactly what it held before, so an end
   * frame cannot lose its start this way. Files of different kinds never
   * exchange: a clip has no business in an image slot.
   */
  function rearrange(from: number, to: number) {
    const a = tiles[from];
    const b = tiles[to];
    if (!a || !b || from === to) return;
    if (a.slot.key === b.slot.key) {
      onChange({ ...refs, [a.slot.key]: moveRefFile(refs[a.slot.key] ?? [], a.index, b.index) });
      return;
    }
    if ((a.slot.media ?? "image") !== (b.slot.media ?? "image")) return;
    const listA = [...(refs[a.slot.key] ?? [])];
    const listB = [...(refs[b.slot.key] ?? [])];
    listA[a.index] = b.file;
    listB[b.index] = a.file;
    onChange({ ...refs, [a.slot.key]: listA, [b.slot.key]: listB });
  }

  /** The parts this file could be given, on a model that has parts to give. */
  function partsFor(tile: Tile): MenuItem[] {
    const kind = tile.slot.media ?? "image";
    const parts = slotsForKind(slots, kind).filter(
      (slot) => slot.key === tile.slot.key || dependenciesMet(slots, countsAfterMove(slots, refs, tile.slot.key, slot.key)),
    );
    if (parts.length < 2) return [];
    return parts.map((slot) => ({
      key: slot.key,
      label: groupOf(slot) === "frame" ? `فریم ${roleWord(slot)}` : "مرجع",
      checked: slot.key === tile.slot.key,
      run: () => assign(tile, slot.key),
    }));
  }

  function menuFor(at: number): MenuItem[] {
    const tile = tiles[at];
    if (!tile) return [];
    const items = partsFor(tile);
    const tag = tags[tile.slot.key]?.[tile.index];
    if (tag) items.push({ key: "tag", label: `درج ${tag} در پرامپت`, run: () => onInsertTag(tag) });
    if (at > 0) items.push({ key: "back", label: "جابه‌جا با قبلی", run: () => rearrange(at, at - 1) });
    if (at < tiles.length - 1) items.push({ key: "forward", label: "جابه‌جا با بعدی", run: () => rearrange(at, at + 1) });
    items.push({ key: "remove", label: "حذف فایل", danger: true, run: () => remove(tile.slot.key, tile.index) });
    return items;
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(false);
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
          ورودی‌ها
        </span>
        {/* What this model will take, rather than one caption per slot saying
            the same thing three times. */}
        <span className="text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
          {tiles.length ? `${faNum(tiles.length)} فایل` : kinds.map((kind) => KIND_WORD[kind]).join(" · ")}
        </span>
      </div>

      {tiles.length === 0 ? (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex h-[72px] w-full items-center justify-center gap-2 rounded-[10px] border border-dashed text-[12px] active:scale-[0.99]"
          style={{
            borderColor: dropping ? "var(--vg-primary)" : "var(--vg-border)",
            background: dropping ? "var(--vg-primary-a05)" : "var(--vg-deep)",
            color: "var(--vg-text-muted)",
          }}
        >
          <Plus size={16} />
          فایل بینداز یا انتخاب کن
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tiles.map((tile, at) => {
            const media = tile.slot.media ?? "image";
            const part = groupOf(tile.slot) === "frame" ? roleWord(tile.slot) : null;
            /* The parts this file could be given. Held here rather than only
               inside the menu, because the badge is now the way to change one
               and it needs to know whether there is a choice to offer. */
            const parts = partsFor(tile);
            const other = parts.find((item) => !item.checked);
            const tag = tags[tile.slot.key]?.[tile.index];
            const pointed = tag ? tagUsed(prompt, tag) : false;
            return (
              <div
                key={`${tile.slot.key}-${tile.index}-${tile.file.url}`}
                className="vg-tile relative size-[72px] overflow-hidden rounded-[10px]"
                draggable
                data-dragging={drag?.from === at}
                data-over={drag != null && drag.over === at && drag.from !== at}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(DRAG_TYPE, String(at));
                  setDrag({ from: at, over: null });
                }}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (drag.over !== at) setDrag({ ...drag, over: at });
                }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.stopPropagation();
                  rearrange(drag.from, at);
                  setDrag(null);
                }}
                style={{ background: "var(--vg-deep)", boxShadow: "inset 0 0 0 1px var(--vg-border)" }}
              >
                <TileMedia file={tile.file} media={media} />

                {/* The kind, for the two a thumbnail cannot show on its own. An
                    image tile is already a picture of itself. Outside the veil:
                    it is a fact about the file, not a control. */}
                {media !== "image" && (
                  <span
                    className="absolute bottom-1 grid size-4 place-items-center rounded"
                    style={{ insetInlineEnd: 4, background: "rgba(0,0,0,0.6)", color: "var(--vg-text-secondary)" }}
                  >
                    {media === "video" ? <FilmSlate size={10} /> : <MusicNote size={10} />}
                  </span>
                )}

                {/* The part it has been given, worn like Higgsfield's — and
                    the way to change it. It used to be a `<span>`: the only
                    route to «فریم پایان» was the «…» menu, which is a control
                    nobody looks for on a 72px thumbnail, and this is the one
                    question about a reference that the file cannot answer
                    itself. Two parts swap on a press; more than two open the
                    menu, because cycling through three is guessing. */}
                {part &&
                  (parts.length >= 2 ? (
                    <button
                      onClick={(event) => {
                        if (parts.length === 2 && other) other.run();
                        else setMenuAt({ at, anchor: event.currentTarget });
                      }}
                      title={parts.length === 2 && other ? `تغییر به ${other.label}` : "تغییر بخش این فایل"}
                      aria-label={`بخش این فایل: فریم ${part}${parts.length === 2 && other ? ` — تغییر به ${other.label}` : " — تغییر"}`}
                      className="absolute bottom-1 rounded px-1.5 text-[10.5px] font-semibold"
                      style={{ insetInlineStart: 4, background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                    >
                      {part}
                    </button>
                  ) : (
                    <span
                      className="absolute bottom-1 rounded px-1.5 text-[10.5px] font-semibold"
                      style={{ insetInlineStart: 4, background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                    >
                      {part}
                    </span>
                  ))}

                {/* A file that is a reference on a model that also has frames
                    to give. It wears no part, so before this there was nothing
                    on it to press — the route from «مرجع» to «فریم شروع» was
                    the «…» menu and nothing else. Opposite corner from the tag,
                    which owns the other one. */}
                {/* Images only: the kind badge owns this corner on a clip or a
                    track, and neither has a second slot to move to anyway. */}
                {!part && media === "image" && parts.length >= 2 && (
                  <button
                    onClick={(event) => {
                      if (parts.length === 2 && other) other.run();
                      else setMenuAt({ at, anchor: event.currentTarget });
                    }}
                    title={parts.length === 2 && other ? `تغییر به ${other.label}` : "انتخاب بخش این فایل"}
                    aria-label={`بخش این فایل: مرجع — ${parts.length === 2 && other ? `تغییر به ${other.label}` : "تغییر"}`}
                    className="vg-tile__part absolute bottom-1 rounded px-1.5 text-[10.5px] font-semibold"
                    style={{ insetInlineEnd: 4, background: "rgba(0,0,0,0.6)", color: "var(--vg-text-secondary)" }}
                  >
                    مرجع
                  </button>
                )}

                {/* Its name, and a way to put that name in the prompt. Lime
                    once the prompt actually points at it, so a glance down the
                    row says which references the text is using and which are
                    sitting there unmentioned. A tile is either a frame or a
                    reference, so this never shares the corner with the part. */}
                {tag && (
                  <button
                    onClick={() => onInsertTag(tag)}
                    title={pointed ? `${tag} در پرامپت هست` : `درج ${tag} در پرامپت`}
                    className="vg-tag absolute bottom-1 rounded px-1.5 py-px font-semibold"
                    style={{
                      insetInlineStart: 4,
                      background: pointed ? "var(--vg-primary)" : "rgba(0,0,0,0.6)",
                      color: pointed ? "var(--vg-text-on-primary)" : "var(--vg-text-secondary)",
                    }}
                  >
                    {tag}
                  </button>
                )}

                <div className="vg-tile__veil absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }}>
                  <button
                    onClick={(e) => setMenuAt({ at, anchor: e.currentTarget })}
                    aria-label={part ? `تنظیمات این فایل — فریم ${part}` : "تنظیمات این فایل"}
                    aria-haspopup="menu"
                    className="absolute top-1 grid size-6 place-items-center rounded-md backdrop-blur-sm"
                    style={{ insetInlineStart: 4, background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
                  >
                    <DotsThree size={16} weight="bold" />
                  </button>
                  <button
                    onClick={() => remove(tile.slot.key, tile.index)}
                    aria-label="حذف فایل"
                    className="absolute top-1 grid size-6 place-items-center rounded-md backdrop-blur-sm"
                    style={{ insetInlineEnd: 4, background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
                  >
                    <X size={12} weight="bold" />
                  </button>
                </div>
              </div>
            );
          })}

          {room && (
            <button
              onClick={() => inputRef.current?.click()}
              aria-label="افزودن فایل"
              className="grid size-[72px] place-items-center rounded-[10px] border border-dashed active:scale-95"
              style={{
                borderColor: dropping ? "var(--vg-primary)" : "var(--vg-border)",
                background: dropping ? "var(--vg-primary-a05)" : "var(--vg-deep)",
                color: "var(--vg-text-muted)",
              }}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
      )}

      {rejected && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--vg-danger)" }}>
          {rejected}
        </p>
      )}

      {menuAt && <TileMenu anchor={menuAt.anchor} items={menuFor(menuAt.at)} onClose={() => setMenuAt(null)} />}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length) void add(picked);
        }}
      />
    </div>
  );
}
