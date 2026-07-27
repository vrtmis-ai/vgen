import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CaretDown, Sparkle, Stack } from "@phosphor-icons/react";
import {
  defaultInput,
  variantControls,
  variantRefs,
  variantMaxPrompt,
  type Control,
  type Family,
  type Variant,
} from "../data/models";
import { priceCoins } from "../data/pricing";
import { useKieRates } from "../lib/kieRates";
import { useI18n } from "../lib/i18n";
import { ControlField, RefUpload, type InputMap, type InputValue, type RefImage, type RefMap } from "../components/controls";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";

export function currentAspect(controls: Control[], input: InputMap): { w: number; h: number } {
  const ac = controls.find((c) => c.kind === "aspect");
  if (ac && ac.kind === "aspect") {
    const opt = ac.options.find((o) => o.value === input[ac.key]) ?? ac.options[0];
    if (opt) return { w: opt.w, h: opt.h };
  }
  return { w: 16, h: 9 };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-medium text-ink2">{children}</div>;
}

export default function Generate({
  family,
  initialVariantId,
  initialPrompt,
  onBack,
  onGenerate,
}: {
  family: Family;
  initialVariantId?: string;
  initialPrompt?: string;
  onBack: () => void;
  onGenerate: (prompt: string, input: InputMap, variant: Variant, refs: RefMap) => void;
}) {
  const firstVariant = family.variants.find((v) => v.id === initialVariantId) ?? family.variants[0]!;
  const [variant, setVariant] = useState<Variant>(firstVariant);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [input, setInput] = useState<InputMap>(() => defaultInput(variantControls(family, firstVariant)));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refImages, setRefImages] = useState<RefMap>({});

  // Object URLs are process-wide; without this every picked image leaks until reload.
  const liveRefs = useRef<RefMap>(refImages);
  useEffect(() => {
    liveRefs.current = refImages;
  }, [refImages]);
  useEffect(() => () => revokeAll(liveRefs.current), []);

  const controls = variantControls(family, variant);
  const refs = variantRefs(family, variant);
  const maxPrompt = variantMaxPrompt(family, variant);
  const basic = useMemo(() => controls.filter((c) => !("advanced" in c && c.advanced)), [controls]);
  const advanced = useMemo(() => controls.filter((c) => "advanced" in c && c.advanced), [controls]);
  const multiVariant = family.variants.length > 1;

  function selectVariant(v: Variant) {
    setVariant(v);
    setInput(defaultInput(variantControls(family, v)));
    setShowAdvanced(false);
    // slots differ per variant, so carrying picks over would mis-key them
    revokeAll(refImages);
    setRefImages({});
  }

  const setValue = (key: string, val: InputValue) => setInput((p) => ({ ...p, [key]: val }));
  // Some models (image-to-video) are rejected outright without their input image.
  // Blocking here is cheaper than letting the provider 422 a paid job.
  const filled = (key: string) => (refImages[key]?.length ?? 0) > 0;
  const needsInput = refs.some((s) => s.required && !filled(s.key));
  // A slot that depends on another: an end frame with no start frame is rejected.
  const orphan = refs.find((s) => s.requires && filled(s.key) && !filled(s.requires));
  const orphanNeeds = orphan && refs.find((s) => s.key === orphan.requires);
  const { t, n } = useI18n();
  const [coverFailed, onCoverError] = useImageFallback();
  useKieRates(); // re-render when the live KIE price table (re)loads
  // Audio models bill per 1000 characters, so their price tracks the prompt as
  // the user types rather than sitting still until a setting changes.
  const price = priceCoins(variant, input, prompt.trim().length);
  // No price means neither the live table nor the fallback has a rate — the
  // provider doesn't offer this combination at all (Hailuo 2.3 has no 1080P
  // at 10s). Selling it would take the user's coins for a job that can't run.
  // maxLength on the textarea only stops typing and pasting, so the length is
  // checked again here. The backend has to check a third time — nothing the
  // client says about length can be trusted once money is attached.
  const promptTooLong = maxPrompt != null && prompt.trim().length > maxPrompt;
  const canGenerate = prompt.trim().length > 0 && !needsInput && !orphan && !promptTooLong && price != null;

  return (
    <div className="relative z-10 min-h-[100dvh] pb-32">
      {/* top bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl">
        <button onClick={onBack} aria-label={t("nav_home")} className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <span className="relative h-9 w-9 overflow-hidden rounded-xl" style={{ background: family.grad }}>
          {family.cover && !isVideoUrl(family.cover) && !coverFailed && (
            <img src={family.cover} alt="" className="absolute inset-0 h-full w-full object-cover" onError={onCoverError} />
          )}
        </span>
        <div className="flex-1">
          <div className="t-title leading-tight">{family.name}</div>
          <div className="t-caption text-ink3">{family.vendor}</div>
        </div>
        <VendorMark vendor={family.vendor} size={24} />
      </div>

      <div className="flex flex-col gap-7 px-4 pt-5">
        {/* variant selector — prominent */}
        {multiVariant && (
          <div className="rounded-bezel border border-line bg-card p-3.5">
            <div className="mb-3 flex items-center gap-1.5">
              <Stack size={15} weight="fill" className="text-ink2" />
              <span className="text-[12.5px] font-medium">{t("g_version")}</span>
              <span className="text-[11px] text-ink3">({n(family.variants.length)} {t("g_versions")})</span>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
              {family.variants.map((v) => {
                const on = v.id === variant.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVariant(v)}
                    className="flex shrink-0 flex-col items-center gap-1 rounded-2xl border px-4 py-2.5 transition-colors active:scale-95"
                    style={
                      on
                        ? { borderColor: "transparent", background: "var(--color-accent)", color: "var(--color-on-accent)" }
                        : { borderColor: "var(--color-line)", background: "var(--color-card2)", color: "var(--color-ink2)" }
                    }
                  >
                    <span className="text-[13px] font-medium">{v.label}</span>
                    {v.badge && <span className="text-[10px]" style={{ color: on ? "color-mix(in srgb, var(--color-on-accent) 70%, transparent)" : "var(--color-ink3)" }}>{v.badge}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* input images — every slot the model supports */}
        {refs.length > 0 && (
          <div className="flex flex-col gap-4">
            <SectionLabel>{t("g_inputs")}</SectionLabel>
            {refs.map((slot) => (
              <RefUpload
                key={slot.key}
                slot={slot}
                images={refImages[slot.key] ?? []}
                onChange={(imgs) => setRefImages((p) => ({ ...p, [slot.key]: imgs }))}
              />
            ))}
          </div>
        )}

        {/* prompt */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <SectionLabel>{t("g_prompt")}</SectionLabel>
            {/* The count only appears near the ceiling — Wan 2.5 stops at 800,
                so on that model it matters; on a 20000 one it never shows. */}
            {maxPrompt != null && prompt.length > maxPrompt * 0.8 ? (
              <span className="text-[11px] tabular-nums text-ink3">
                {n(prompt.length)} / {n(maxPrompt)}
              </span>
            ) : (
              <span className="text-[11px] text-ink3">{t("g_prompt_hint")}</span>
            )}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to create…"
            rows={4}
            maxLength={maxPrompt ?? undefined}
            className="ltr w-full resize-none rounded-bezel border border-line bg-card p-4 text-[14px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent focus:outline-none"
          />
        </div>

        {/* settings */}
        <div className="flex flex-col gap-6">
          <SectionLabel>{t("g_settings")}</SectionLabel>
          {basic.map((c) => (
            <ControlField key={c.key} control={c} value={input[c.key]} onChange={setValue} />
          ))}

          {advanced.length > 0 && (
            <>
              <button
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex items-center justify-between text-[12.5px] text-ink2 active:scale-[0.99]"
              >
                <span>{t("g_advanced")}</span>
                <CaretDown size={16} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col gap-6"
                  >
                    {advanced.map((c) => (
                      <ControlField key={c.key} control={c} value={input[c.key]} onChange={setValue} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>

      {/* sticky CTA */}
      <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 border-t border-line bg-surface/85 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <button
          onClick={() => onGenerate(prompt.trim(), input, variant, refImages)}
          disabled={!canGenerate}
          className="btn-accent flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-semibold disabled:opacity-40"
        >
          <Sparkle size={18} weight="fill" />
          <span>{t("g_create")}</span>
          {price != null && (
            <span className="ms-1 flex items-center gap-1 rounded-full bg-black/12 px-2.5 py-0.5 text-[12.5px]">
              <span>⬡</span>
              {n(price)}
            </span>
          )}
        </button>
        <div className="pt-1.5 text-center text-[10.5px] text-ink3">
          {needsInput
            ? t("g_need_input")
            : orphanNeeds
              ? `${t("g_need_also")} ${orphanNeeds.label}`
              : price != null
                ? `≈ ${n(price)} ${t("g_est_for")}`
                : t("g_no_rate")}
        </div>
      </div>
    </div>
  );
}

/** Drop every thumbnail URL in a RefMap. The underlying File objects stay usable. */
function revokeAll(map: RefMap) {
  for (const imgs of Object.values(map)) for (const img of imgs as RefImage[]) URL.revokeObjectURL(img.url);
}
