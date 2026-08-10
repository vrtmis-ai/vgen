import { useState } from "react";
import { Plus, Minus, Sparkle, PencilSimple, Heart, DownloadSimple, ArrowsClockwise, ArrowsOut } from "@phosphor-icons/react";
import { FAMILIES, getFamily, type Family, type Variant } from "../data/models";
import type { InputMap } from "../components/controls";
import { useCreateState, valueLabel, sliderSteps, rangeOf, type ChipControl } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { EXPLORE } from "../data/explore";
import { CoinMark } from "../components/chrome";
import { AssetViewer, type ViewerAsset } from "../components/AssetViewer";
import { PopoverChip } from "../components/Popover";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { JustifiedRows } from "../components/JustifiedRows";
import { ModelChip } from "../components/ModelPicker";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The image studio.

   This is NOT the video studio with a different catalog, and that mistake is
   worth naming: the reference gives each modality its own architecture, and
   they share only a token layer.

   /ai/image has no panel and no page margin. The user's own images tile
   edge-to-edge across the whole viewport with no gutters, and the entire create
   form is one FIXED glass card floating over them — measured at 1120x258,
   radius 26, `rgba(15,17,19,.96)` under a 10px backdrop blur, 22px padding.

   The logic is sound: on an image surface the output is a wall of pictures and
   the form is a small thing you summon over it. On the video surface there are
   far fewer outputs and far more settings, so the form earns a permanent column
   and the outputs get the canvas. Same product, opposite arrangement, because
   the content is shaped differently.
   --------------------------------------------------------------------------- */

const art = (seed: string, w = 600, h = 800) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/**
 * How each frame identifies itself to a screen reader.
 *
 * The prompt is the only thing that distinguishes one output from another, so
 * it is the name, with the model as the fallback for an output that never
 * carried one.
 *
 * The ordinal is not padding. Generating four images from one prompt is the
 * ordinary case, and those four are then genuinely indistinguishable by text —
 * "the second of four" is the only thing left to say about them. It is added
 * only where a name actually repeats, so a wall of distinct prompts stays
 * quiet rather than being numbered for no reason.
 */
function tileNames(assets: ViewerAsset[]): string[] {
  const base = assets.map((a) => {
    const p = a.prompt.trim();
    if (p) return p.length > 60 ? `${p.slice(0, 60)}…` : p;
    return getFamily(a.familyId)?.name ?? "خروجی";
  });
  const total = new Map<string, number>();
  for (const b of base) total.set(b, (total.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((b) => {
    if ((total.get(b) ?? 0) < 2) return b;
    const nth = (seen.get(b) ?? 0) + 1;
    seen.set(b, nth);
    return `${b} (${nth} از ${total.get(b)})`;
  });
}

/** Every chip in the dock. The menu goes through PopoverChip, which portals it
 *  to <body> — the chip row scrolls horizontally, and an overflow container
 *  clips on both axes, so an in-tree menu is cut to the row's 40px. */
const CHIP_CLASS = "flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold";
const CHIP_STYLE: React.CSSProperties = { background: "var(--vg-surface-overlay)", color: "var(--vg-text)" };

function chipOptions(c: ChipControl) {
  return c.kind === "slider"
    ? sliderSteps(c).map((v) => ({ value: (c.asString ? String(v) : v) as string | number, label: `${v}${c.unit ? ` ${c.unit}` : ""}` }))
    : c.kind === "toggle"
      ? []
      : c.options.map((o) => ({ value: o.value as string | number, label: o.label }));
}

/** The hover stack the reference puts on every tile: favourite, download,
 *  recreate, enlarge. Before this the tile did nothing at all — the thing the
 *  user paid for was a picture you could look at and not act on. */
function TileActions({
  onOpen,
  onDownload,
  inline,
  of,
}: {
  onOpen: () => void;
  onDownload: () => void;
  inline?: boolean;
  /**
   * What this stack acts on, for the accessible name.
   *
   * Without it a wall of 42 frames is 42 buttons all called "دانلود". On screen
   * that is unambiguous — the button is sitting on its picture — but a screen
   * reader's button list is exactly that list, stripped of position, and it
   * becomes four names repeated 42 times with no way to tell which is which.
   * The visible tooltip stays the short verb; only the name carries the target.
   */
  of: string;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    /* On the wall the stack overlays the image and appears on hover. In a list
       row there is nothing to overlay, so it sits in the row and stays visible
       — hidden-until-hover in a list is just a hidden control. */
    <div
      className={
        inline
          ? "flex flex-row gap-1"
          : "absolute top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      }
      style={inline ? undefined : { insetInlineEnd: "0.375rem" }}
    >
      {[
        { Icon: Heart, label: "پسندیدن", on: () => {} },
        { Icon: DownloadSimple, label: "دانلود", on: onDownload },
        { Icon: ArrowsClockwise, label: "دوباره بساز", on: () => {} },
        { Icon: ArrowsOut, label: "بزرگ کن", on: onOpen },
      ].map(({ Icon, label, on }) => (
        <button
          key={label}
          aria-label={`${label} — ${of}`}
          title={label}
          onClick={stop(on)}
          className="grid size-7 place-items-center rounded-lg backdrop-blur-md"
          style={{ background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}

export default function StudioImage({
  gens,
  onGenerate,
  onOpenModel,
}: {
  gens: Generation[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
  onOpenModel: (familyId: string, prompt?: string) => void;
}) {
  const { n } = useI18n();
  const families = FAMILIES.filter((f) => f.kind === "image");
  const s = useCreateState(families);
  const [count, setCount] = useState(1);
  const [viewing, setViewing] = useState<ViewerAsset | null>(null);
  const view = useViewMode("image", { mode: "grid", density: 4 });

  const mine = gens.filter((g) => g.kind === "image");
  // Until the user has a library, the seeded examples stand in for one — an
  // empty wall would leave the dock floating over nothing.
  const wall: ViewerAsset[] =
    mine.length > 0
      ? mine.map((g) => ({ id: g.id, url: g.outputUrl ?? art(g.id), prompt: g.prompt, familyId: g.familyId, w: g.w, h: g.h, createdAt: g.createdAt }))
      : EXPLORE.map((e) => ({ id: e.id, url: art(e.seed), prompt: e.prompt, familyId: e.familyId, w: 1152, h: 1536 }));

  /* Mixed ratios on purpose: the wall is only worth a justified layout if the
     items actually differ, and the seeded stand-ins were all one shape. Real
     generations carry their own w/h. */
  const RATIOS = [9 / 16, 3 / 4, 16 / 9, 1, 4 / 5];
  const shaped = Array.from({ length: 42 }, (_, i) => {
    const base = wall[i % wall.length]!;
    const ratio = mine.length > 0 ? base.w / base.h : RATIOS[i % RATIOS.length]!;
    const [w, h] = ratio >= 1 ? [1200, Math.round(1200 / ratio)] : [Math.round(900 * ratio), 900];
    return {
      key: `${base.id}-${i}`,
      ratio,
      asset: { ...base, w, h, url: art(`${base.id}-${i}`, w, h) } as ViewerAsset,
    };
  });
  // Named as a set, not one at a time: whether a name needs an ordinal is a
  // fact about the whole wall, so it cannot be decided from inside one tile.
  const names = tileNames(shaped.map((t) => t.asset));
  const tiles = shaped.map((t, i) => ({ ...t, name: names[i]! }));

  // No blob, no fetch: the asset is a remote URL and `download` on an anchor is
  // the whole mechanism. It becomes a real save once outputs live in our own
  // storage and the response carries Content-Disposition.
  const download = (a: ViewerAsset) => {
    const el = document.createElement("a");
    el.href = a.url;
    el.download = `vgen-${a.id}.jpg`;
    el.rel = "noopener";
    el.click();
  };

  return (
    // @container is required, not decorative: ViewControls asks `@xl` whether
    // there is room for the density group, and a container query with no
    // container ancestor never matches — the control would vanish for good.
    // Here the wall is full width, so the container is effectively the page.
    <div className="@container relative">
      {/* Size only, no list. This surface is a wall of frames — it exists so you
          can scan pictures, and a list of them is the same wall with the
          pictures made small. The reference does not offer one here either. */}
      <div className="sticky top-11 z-20 flex justify-start px-3 py-2">
        <ViewControls mode="grid" density={view.density} onMode={() => {}} onDensity={view.setDensity} modes={false} />
      </div>

      {/* A tool surface with no visible title still needs one. The wall and the
          dock carry no page heading, so the document started at h2 — or, here,
          at nothing at all — and a screen reader arriving on a route change had
          no way to hear which studio it landed in. Hidden, because the layout is
          right as it is; the heading is orientation, not decoration. */}
      <h1 className="sr-only">ساخت تصویر</h1>

      {/* Edge to edge, no page margin, no gutter. The wall is the page. */}
      {/* Repeated to 42 so the wall reaches the fold on a desktop viewport. The
          dock floats over it, and a wall that stops halfway leaves the dock
          hanging in empty space, which is not what the layout is. */}
      {/* Justified rows, not a grid. Each image keeps its true aspect ratio and
          the row's height is whatever makes its widths fill the container — so
          nothing is cropped. A uniform cell would crop every 16:9 and 9:16 on
          the one page whose job is letting you judge what you just paid for. */}
      <div className="pb-[280px]">
        <JustifiedRows
          items={tiles}
          targetHeight={view.rowHeight}
          gap={2}
          render={(t) => (
            <div className="group relative size-full overflow-hidden" style={{ background: "var(--vg-surface)" }}>
              <button onClick={() => setViewing(t.asset)} className="absolute inset-0" aria-label={`باز کردن — ${t.name}`}>
                <img src={t.asset.url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                <span className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ background: "rgba(0,0,0,0.25)" }} />
              </button>
              <TileActions onOpen={() => setViewing(t.asset)} onDownload={() => download(t.asset)} of={t.name} />
            </div>
          )}
        />
      </div>

      {viewing && (
        <AssetViewer
          asset={viewing}
          onClose={() => setViewing(null)}
          onOpenModel={(id, prompt) => {
            setViewing(null);
            onOpenModel(id, prompt);
          }}
          onDownload={download}
        />
      )}

      {/* The dock. Fixed, centred, glass. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3">
        <div
          className="pointer-events-auto w-full max-w-[1120px] rounded-[26px] p-[2px]"
          style={{ background: "var(--vg-border)" }}
        >
          <div
            className="rounded-3xl p-4 md:p-5"
            style={{ background: "rgba(18,18,18,0.96)", backdropFilter: "blur(11px)" }}
          >
            <div className="flex items-start gap-3">
              <button
                aria-label="افزودن تصویر مرجع"
                className="grid size-8 shrink-0 place-items-center rounded-[10px]"
                style={{ background: "var(--vg-surface-raised)", color: "var(--vg-text)" }}
              >
                <Plus size={15} weight="bold" />
              </button>
              <textarea
                value={s.prompt}
                onChange={(e) => s.setPrompt(e.target.value)}
                rows={2}
                placeholder="تصویری که در ذهن داری را توصیف کن."
                className="hide-scrollbar min-h-[52px] w-full resize-none bg-transparent text-[13.5px] leading-6 outline-none"
                style={{ color: "var(--vg-text)" }}
              />
            </div>

            <div className="mt-3 flex items-end gap-2">
              <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {/* One chip for the model, not a family chip plus a variant
                    chip. The picker shows both in one panel, so the dock does
                    not have to expose our data model to make the choice. */}
                <ModelChip
                  families={families}
                  family={s.family}
                  variant={s.variant}
                  onPickFamily={s.setFamily}
                  onPickVariant={s.setVariant}
                  className={CHIP_CLASS}
                  style={CHIP_STYLE}
                />

                {s.chips.map((c) =>
                  c.kind === "toggle" ? (
                    <button
                      key={c.key}
                      onClick={() => s.set(c.key, !s.input[c.key])}
                      className="h-10 shrink-0 rounded-xl px-3 text-[13px] font-semibold"
                      style={{
                        background: s.input[c.key] ? "rgba(233,95,24,0.16)" : "var(--vg-surface-overlay)",
                        color: s.input[c.key] ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                      }}
                    >
                      {c.label}
                    </button>
                  ) : (
                    <PopoverChip
                      key={c.key}
                      label={valueLabel(c, s.input)}
                      value={String(s.input[c.key])}
                      options={chipOptions(c)}
                      range={rangeOf(c)}
                      onPick={(v) => s.set(c.key, c.kind === "slider" && c.asString ? String(v) : v)}
                      className={CHIP_CLASS}
                      style={CHIP_STYLE}
                    />
                  ),
                )}

                {/* The count stepper. Images are cheap enough to want four at a
                    time; video never is, which is why only this studio has it. */}
                <div
                  className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-1"
                  style={{ background: "var(--vg-surface-overlay)" }}
                >
                  <button onClick={() => setCount((c) => Math.max(1, c - 1))} className="grid size-7 place-items-center rounded-lg" aria-label="کاهش تعداد خروجی">
                    <Minus size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                  </button>
                  <span className="vg-numeric w-8 text-center text-[13px]" style={{ color: "var(--vg-text)" }}>
                    {n(count)}
                  </span>
                  <button onClick={() => setCount((c) => Math.min(4, c + 1))} className="grid size-7 place-items-center rounded-lg" aria-label="افزایش تعداد خروجی">
                    <Plus size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                  </button>
                </div>

                <button
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px]"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                >
                  <PencilSimple size={14} />
                  رسم
                </button>
              </div>

              <button
                disabled={!s.ready}
                onClick={() => onGenerate(s.family, s.variant, s.prompt.trim(), s.input)}
                className="flex h-[52px] w-[132px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[13.5px] font-bold transition-opacity disabled:opacity-35"
                style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkle size={14} weight="fill" />
                  بساز
                </span>
                <span className="flex items-center gap-1 text-[11.5px] font-semibold opacity-90">
                  <CoinMark size={11} />
                  <span className="vg-numeric">{s.price === null ? "—" : n(s.price * count)}</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
