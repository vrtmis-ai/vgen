import { useState } from "react";
import { Plus, Minus, Sparkle, Heart, DownloadSimple, ArrowsClockwise, ArrowsOut, Lock } from "@phosphor-icons/react";
import { type Family, type Variant } from "../data/models";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";
import type { InputMap } from "../components/controls";
import { useCreateState, valueLabel, sliderSteps, rangeOf, type ChipControl } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { CoinMark } from "../components/chrome";
import { AssetViewer, type ViewerAsset } from "../components/AssetViewer";
import { PopoverChip } from "../components/Popover";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { JustifiedRows } from "../components/JustifiedRows";
import { ModelChip } from "../components/ModelPicker";
import { UnlimitedSwitch } from "../components/UnlimitedSwitch";
import { unlimitedFit } from "../lib/unlimited";
import { promptDir } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useSession } from "../runtime/providers/SessionProvider";
import { useAccess } from "../lib/access";

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
function tileNames(assets: ViewerAsset[], familyName: (familyId: string) => string | undefined): string[] {
  const base = assets.map((a) => {
    const p = a.prompt.trim();
    if (p) return p.length > 60 ? `${p.slice(0, 60)}…` : p;
    return familyName(a.familyId) ?? "خروجی";
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
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap, preferUnlimited: boolean) => void;
  onOpenModel: (familyId: string, prompt?: string) => void;
}) {
  const { t, n } = useI18n();
  const catalogFamilies = useCatalogFamilies();
  const families = catalogFamilies.filter((f) => f.kind === "image");
  const s = useCreateState(families);
  const access = useAccess();
  // A visitor sees the whole studio — models, controls, the price — and only
  // the button that would spend turns into the way to get an account. The
  // upgrade lock is skipped for them: they have no plan to upgrade from, and
  // access.onUpgrade opens a wallet drawer nobody owns yet.
  const { user, signIn } = useSession();
  const visitor = user === null;
  // Reachable *and* chosen. Either alone leaves the button lying about cost.
  const freeNow = s.preferUnlimited && unlimitedFit(s.variant, s.input, access.tier)?.available === true;
  const locked = !access.can(s.family.id);
  const need = locked ? access.needs(s.family.id) : null;
  const [count, setCount] = useState(1);
  const [viewing, setViewing] = useState<ViewerAsset | null>(null);
  const view = useViewMode("image", { mode: "grid", density: 4 });

  const mine = gens.filter((g) => g.kind === "image");
  /* Jobs still running are held out of the wall and put in front of it.
     The wall repeats its items to fill 42 tiles, and a running job repeated
     forty-two times would be forty-two progress bars for one generation. It
     also has no picture yet, so it cannot take part in a layout whose whole
     job is arranging pictures. */
  const running = mine.filter((g) => g.status === "running");
  const finished = mine.filter((g) => g.status !== "running");
  /* No stand-in library.
     This used to fall back to the seeded examples so the dock would not float
     over nothing. It filled the create surface with forty-two pictures the
     account did not make — a promise on arrival, and a gallery over the one
     screen that is supposed to be a workbench. An empty canvas is the correct
     first state, not a hole to be papered over; see the empty branch below. */
  const wall: ViewerAsset[] = finished.map((g) => ({
    id: g.id,
    url: g.outputUrl ?? art(g.id),
    prompt: g.prompt,
    familyId: g.familyId,
    w: g.w,
    h: g.h,
    createdAt: g.createdAt,
  }));

  /* Mixed ratios on purpose: the wall is only worth a justified layout if the
     items actually differ, and the seeded stand-ins were all one shape. Real
     generations carry their own w/h. */
  /* Two things met here, and both survive.

     From main: real work is rendered once each, at its own size, from its own
     `outputUrl`. The old code repeated the wall up to 42 frames and gave every
     frame a fresh `art()` placeholder — scaffolding for an empty library that,
     run over real generations, showed one finished image as forty-two unrelated
     stock pictures. That is what "the site does not work" looked like from
     outside.

     From this branch: when there is nothing finished, the wall is empty rather
     than filled with seeded examples. A new account was seeing strangers'
     photographs sitting exactly where its own work would later appear,
     captioned as history. The empty branch below is the first state now — a
     designed one, not a hole — so there is nothing left for a demo wall to
     paper over. */
  const shaped = wall.map((base) => ({
    key: base.id,
    ratio: base.w / base.h,
    asset: base,
    pending: null as Generation | null,
  }));
  // Named as a set, not one at a time: whether a name needs an ordinal is a
  // fact about the whole wall, so it cannot be decided from inside one tile.
  const names = tileNames(
    shaped.map((t) => t.asset),
    (familyId) => catalogFamilies.find((family) => family.id === familyId)?.name,
  );
  // Running jobs first, newest at the head, so the thing the user just paid for
  // is the thing they are looking at.
  const tiles = [
    ...running.map((g) => ({
      key: g.id,
      ratio: g.w / g.h,
      asset: { id: g.id, url: "", prompt: g.prompt, familyId: g.familyId, w: g.w, h: g.h } as ViewerAsset,
      pending: g,
      name: g.prompt.trim().slice(0, 60) || g.name,
    })),
    ...shaped.map((t, i) => ({ ...t, name: names[i]! })),
  ];

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
      {/* Nothing to size when there is nothing on the wall. */}
      {tiles.length > 0 && (
        <div className="sticky top-11 z-20 flex justify-start px-3 py-2">
          <ViewControls mode="grid" density={view.density} onMode={() => {}} onDensity={view.setDensity} modes={false} />
        </div>
      )}

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
      {/* The canvas before anything exists.
          Centred and quiet, the way the reference opens: a fanned trio, a line
          saying what this surface is for, and the dock below as the only thing
          to press. It is not blank — a blank surface tells somebody nothing —
          but it is empty, which is the truth.

          THE TRIO IS A SLOT. The reference fans three of its own outputs here,
          which works because they are outputs. Ours would have been
          `picsum.photos` stock — the same stand-ins that used to fill this whole
          wall — and three of those under a heading claims they are what this
          product makes. So they carry each model's own `grad` until we have real
          seeded examples to put in them, which is the `cover ?? grad` fallback
          this codebase already uses for every model card.

          The heading does not name the selected model: it is one click from
          being a different one, and a heading that commits to it reads as a
          decision already made.

          `.t-ghost` above it rather than a second heading line. The reference
          buys presence with uppercase Space Grotesk and Persian has no
          uppercase — this is the device the design system added as its answer to
          exactly that, and it is Latin by contract, hence lang="en". */}
      {tiles.length === 0 ? (
        <div
          className="grid place-items-center px-6 text-center"
          /* Centred between the bar and the dock, not in the viewport.
             `min-h-[52dvh] pb-[280px]` centred the block inside the 52dvh box
             and then hung 280px of padding under it, which put the text a third
             of the way down the screen with a void beneath. The height is now
             exactly the space that is free — viewport less the banner, the bar
             and the dock — so `place-items-center` lands where the eye expects.
             11rem is the dock's own height plus the gap it floats on. */
          style={{ minHeight: "calc(100dvh - var(--vg-banner-height, 0px) - 2.75rem - 11rem)" }}
        >
          <div>
            <div aria-hidden className="mb-7 flex items-end justify-center">
              {families.slice(0, 3).map((f, i) => (
                <span
                  key={f.id}
                  className="block h-[104px] w-[82px] rounded-2xl border shadow-2xl"
                  style={{
                    background: f.grad,
                    borderColor: "var(--vg-border-subtle)",
                    // Fanned from the middle out. `rotate` and the overlap are
                    // physical on purpose: a fan reads the same in both scripts,
                    // and mirroring it would only move which card is on top.
                    rotate: `${(i - 1) * 7}deg`,
                    marginInline: i === 1 ? "-10px" : "0",
                    zIndex: i === 1 ? 1 : 0,
                  }}
                />
              ))}
            </div>
            <span className="t-ghost block" lang="en">
              {t("st_empty_label")}
            </span>
            <h2 className="t-h1 mt-2 text-balance">{t("st_empty_title")}</h2>
            <p className="t-caption mx-auto mt-2 max-w-[42ch] text-pretty" style={{ color: "var(--vg-text-muted)" }}>
              {t("st_empty_sub")}
            </p>
          </div>
        </div>
      ) : (
        <div className="pb-[280px]">
          <JustifiedRows
            items={tiles}
            targetHeight={view.rowHeight}
            gap={2}
            render={(t) =>
              /* A job with no picture yet: the tile holds its place in the wall
               and shows the bar. Not clickable and no action stack — there is
               nothing to open, download or recreate until it lands. */
              t.pending ? (
                <div className="relative grid size-full place-items-center overflow-hidden" style={{ background: t.pending.grad }}>
                  <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} />
                  <div className="relative w-2/3 max-w-[180px]">
                    <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
                      <div
                        className="h-full transition-[width] duration-200 ease-out"
                        style={{ width: `${Math.round(t.pending.progress ?? 0)}%`, background: "var(--vg-primary)" }}
                      />
                    </div>
                    <p className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
                      در حال ساخت… <span className="vg-numeric">{Math.round(t.pending.progress ?? 0)}%</span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="group relative size-full overflow-hidden" style={{ background: "var(--vg-surface)" }}>
                  <button onClick={() => setViewing(t.asset)} className="absolute inset-0" aria-label={`باز کردن — ${t.name}`}>
                    <img src={t.asset.url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                    <span
                      className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ background: "rgba(0,0,0,0.25)" }}
                    />
                  </button>
                  <TileActions onOpen={() => setViewing(t.asset)} onDownload={() => download(t.asset)} of={t.name} />
                </div>
              )
            }
          />
        </div>
      )}

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
        <div className="pointer-events-auto w-full max-w-[1120px] rounded-[26px] p-[2px]" style={{ background: "var(--vg-border)" }}>
          <div className="rounded-3xl p-4 md:p-5" style={{ background: "rgba(18,18,18,0.96)", backdropFilter: "blur(11px)" }}>
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
                dir={promptDir(s.prompt)}
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
                      className={CHIP_CLASS}
                      style={{
                        ...CHIP_STYLE,
                        ...(s.input[c.key] ? { background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)" } : {}),
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
                    time; video never is, which is why only this studio has it.

                    Built from CHIP_CLASS so it is the same object as every other
                    control — it was the one chip with its own padding, and at a
                    glance the row read as "four chips and a widget". */}
                <div className={`${CHIP_CLASS} gap-1 px-1`} style={CHIP_STYLE}>
                  <button
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    className="grid size-7 place-items-center rounded-lg"
                    aria-label="کاهش تعداد خروجی"
                  >
                    <Minus size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                  </button>
                  <span className="vg-numeric w-8 text-center text-[13px]" style={{ color: "var(--vg-text)" }}>
                    {n(count)}
                  </span>
                  <button
                    onClick={() => setCount((c) => Math.min(4, c + 1))}
                    className="grid size-7 place-items-center rounded-lg"
                    aria-label="افزایش تعداد خروجی"
                  >
                    <Plus size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                  </button>
                </div>

                {/* The switch belongs in the row, not beside it.
                    It is a control like the others — it changes what the button
                    costs — and standing it outside the scroller gave it a shape
                    and a height nothing else had. */}
                <UnlimitedSwitch variant={s.variant} input={s.input} on={s.preferUnlimited} onChange={s.setPreferUnlimited} />
              </div>

              {/* See FormPanel: a locked model buys an upgrade button, not a
                  greyed-out price. */}
              {locked && !visitor ? (
                <button
                  onClick={access.onUpgrade}
                  className={`${CHIP_CLASS} justify-center px-4`}
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                >
                  <Lock size={14} weight="fill" />
                  {need ? <bdi>ارتقا به {need.name}</bdi> : "ارتقای پلن"}
                </button>
              ) : (
                /* One line and one height, like every control beside it.
                   It was 52px and two-line to fit the price underneath, which
                   made the primary action the one object in the row with its own
                   geometry — and a row where the important thing is a different
                   size is a row you read twice. The reference puts the cost
                   inline for the same reason. Colour is what marks it now, and
                   colour is enough: it is the only lime in the dock. */
                <button
                  disabled={!visitor && !s.ready}
                  onClick={() => (visitor ? signIn() : onGenerate(s.family, s.variant, s.prompt.trim(), s.input, s.preferUnlimited))}
                  className={`${CHIP_CLASS} justify-center px-4 transition-opacity disabled:opacity-35`}
                  style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                >
                  <Sparkle size={14} weight="fill" />
                  {visitor ? t("visitor_cta") : "بساز"}
                  <span className="flex items-center gap-1 opacity-90">
                    <CoinMark size={11} />
                    {/* The local table prices the metered pipe. When the other
                        one is chosen and reachable, the figure is not a smaller
                        price — there is no price. The quote still decides. */}
                    <span className="vg-numeric">{freeNow ? t("unl_free") : s.price === null ? "—" : n(s.price * count)}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
