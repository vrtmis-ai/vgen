import { useState } from "react";
import { Plus, Minus, Sparkle, PencilSimple } from "@phosphor-icons/react";
import { FAMILIES, type Family, type Variant } from "../data/models";
import type { InputMap } from "../components/controls";
import { useCreateState, valueLabel, sliderSteps, type ChipControl } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { EXPLORE } from "../data/explore";
import { CoinMark } from "../components/chrome";
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

function Chip({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: string | number; label: string }[];
  value: string;
  onPick: (v: string | number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold"
        style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
      >
        {label}
      </button>
      {open && (
        <>
          {/* A transparent full-screen lid rather than a document listener: the
              dock is `fixed`, so a click anywhere else must close it and this
              needs no cleanup or capture-phase ordering. */}
          <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-12 z-50 max-h-64 min-w-[170px] overflow-y-auto rounded-xl p-1"
            style={{
              insetInlineStart: 0,
              background: "var(--vg-surface-raised)",
              border: "1px solid var(--vg-border)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
            }}
          >
            {options.map((o) => (
              <button
                key={String(o.value)}
                onClick={() => {
                  onPick(o.value);
                  setOpen(false);
                }}
                className="flex w-full rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-white/5"
                style={{ color: String(o.value) === value ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function chipOptions(c: ChipControl) {
  return c.kind === "slider"
    ? sliderSteps(c).map((v) => ({ value: (c.asString ? String(v) : v) as string | number, label: `${v}${c.unit ? ` ${c.unit}` : ""}` }))
    : c.kind === "toggle"
      ? []
      : c.options.map((o) => ({ value: o.value as string | number, label: o.label }));
}

export default function StudioImage({
  gens,
  onGenerate,
  onOpen,
}: {
  gens: Generation[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
  onOpen: (g: Generation) => void;
}) {
  const { n } = useI18n();
  const families = FAMILIES.filter((f) => f.kind === "image");
  const s = useCreateState(families);
  const [count, setCount] = useState(1);
  const [pickModel, setPickModel] = useState(false);

  const mine = gens.filter((g) => g.kind === "image");
  // Until the user has a library, the seeded examples stand in for one — an
  // empty wall would leave the dock floating over nothing.
  const wall = mine.length > 0 ? mine.map((g) => ({ key: g.id, seed: g.id, gen: g })) : EXPLORE.map((e) => ({ key: e.id, seed: e.seed, gen: null }));

  return (
    <div className="relative">
      {/* Edge to edge, no page margin, no gutter. The wall is the page. */}
      {/* Repeated to 42 so the wall reaches the fold on a desktop viewport. The
          dock floats over it, and a wall that stops halfway leaves the dock
          hanging in empty space, which is not what the layout is. */}
      <div className="grid grid-cols-3 gap-px pb-[280px] sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => wall[i % wall.length]!).map((w, i) => (
          <button
            key={`${w.key}-${i}`}
            onClick={() => w.gen && onOpen(w.gen)}
            className="relative block aspect-[3/4] overflow-hidden"
            style={{ background: "var(--vg-surface)" }}
          >
            <img src={art(`${w.seed}-${i}`)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          </button>
        ))}
      </div>

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
                <div className="relative shrink-0">
                  <button
                    onClick={() => setPickModel((v) => !v)}
                    className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold"
                    style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                  >
                    {s.family.name}
                  </button>
                  {pickModel && (
                    <>
                      <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setPickModel(false)} />
                      <div
                        className="absolute bottom-12 z-50 max-h-72 min-w-[220px] overflow-y-auto rounded-xl p-1"
                        style={{ insetInlineStart: 0, background: "var(--vg-surface-raised)", border: "1px solid var(--vg-border)" }}
                      >
                        {families.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => {
                              s.setFamily(f);
                              setPickModel(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-white/5"
                          >
                            <span className="flex-1 truncate text-[13px]" style={{ color: f.id === s.family.id ? "var(--vg-primary-soft)" : "var(--vg-text)" }}>
                              {f.name}
                            </span>
                            <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>{f.vendor}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

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
                    <div key={c.key} className="shrink-0">
                      <Chip
                        label={valueLabel(c, s.input)}
                        value={String(s.input[c.key])}
                        options={chipOptions(c)}
                        onPick={(v) => s.set(c.key, v)}
                      />
                    </div>
                  ),
                )}

                {/* The count stepper. Images are cheap enough to want four at a
                    time; video never is, which is why only this studio has it. */}
                <div
                  className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-1"
                  style={{ background: "var(--vg-surface-overlay)" }}
                >
                  <button onClick={() => setCount((c) => Math.max(1, c - 1))} className="grid size-7 place-items-center rounded-lg" aria-label="کمتر">
                    <Minus size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                  </button>
                  <span className="vg-numeric w-8 text-center text-[13px]" style={{ color: "var(--vg-text)" }}>
                    {n(count)}
                  </span>
                  <button onClick={() => setCount((c) => Math.min(4, c + 1))} className="grid size-7 place-items-center rounded-lg" aria-label="بیشتر">
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
