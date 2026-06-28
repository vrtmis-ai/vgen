import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CaretDown, Sparkle, Stack } from "@phosphor-icons/react";
import {
  defaultInput,
  variantControls,
  variantRefs,
  type Control,
  type Family,
  type Variant,
} from "../data/models";
import { priceCoins } from "../data/pricing";
import { ControlField, RefUpload, type InputMap, type InputValue } from "../components/controls";
import { faNum } from "../lib/format";

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
  onGenerate: (prompt: string, input: InputMap, variant: Variant) => void;
}) {
  const firstVariant = family.variants.find((v) => v.id === initialVariantId) ?? family.variants[0]!;
  const [variant, setVariant] = useState<Variant>(firstVariant);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [input, setInput] = useState<InputMap>(() => defaultInput(variantControls(family, firstVariant)));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const controls = variantControls(family, variant);
  const refs = variantRefs(family, variant);
  const basic = useMemo(() => controls.filter((c) => !("advanced" in c && c.advanced)), [controls]);
  const advanced = useMemo(() => controls.filter((c) => "advanced" in c && c.advanced), [controls]);
  const multiVariant = family.variants.length > 1;

  function selectVariant(v: Variant) {
    setVariant(v);
    setInput(defaultInput(variantControls(family, v)));
    setShowAdvanced(false);
  }

  const setValue = (key: string, val: InputValue) => setInput((p) => ({ ...p, [key]: val }));
  const canGenerate = prompt.trim().length > 0;
  const price = priceCoins(variant, input);

  return (
    <div className="relative z-10 min-h-[100dvh] pb-32">
      {/* top bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl">
        <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" />
        </button>
        <div className="flex-1">
          <div className="text-[15px] font-semibold leading-tight">{family.name}</div>
          <div className="text-[11px] text-ink3">{family.vendor}</div>
        </div>
      </div>

      <div className="flex flex-col gap-7 px-4 pt-5">
        {/* variant selector — prominent */}
        {multiVariant && (
          <div className="rounded-bezel border border-line bg-card p-3.5">
            <div className="mb-3 flex items-center gap-1.5">
              <Stack size={15} weight="fill" className="text-ink2" />
              <span className="text-[12.5px] font-medium">نسخه‌ی مدل</span>
              <span className="text-[11px] text-ink3">({faNum(family.variants.length)} نسخه)</span>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
              {family.variants.map((v) => {
                const on = v.id === variant.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVariant(v)}
                    className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl border px-4 py-2.5 transition-colors active:scale-95 ${
                      on ? "border-transparent bg-ink text-bg" : "border-line bg-card2 text-ink2"
                    }`}
                  >
                    <span className="text-[13px] font-medium">{v.label}</span>
                    {v.badge && <span className={`text-[10px] ${on ? "text-bg/70" : "text-ink3"}`}>{v.badge}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* input images — every slot the model supports */}
        {refs.length > 0 && (
          <div className="flex flex-col gap-4">
            <SectionLabel>تصاویر ورودی</SectionLabel>
            {refs.map((slot) => (
              <RefSlotField key={slot.key} slotKey={slot.key} label={slot.label} max={slot.max} />
            ))}
          </div>
        )}

        {/* prompt */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <SectionLabel>پرامپت</SectionLabel>
            <span className="text-[11px] text-ink3">انگلیسی بنویس برای بهترین نتیجه</span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to create…"
            rows={4}
            className="ltr w-full resize-none rounded-bezel border border-line bg-card p-4 text-[14px] leading-relaxed text-ink placeholder:text-ink3 focus:border-line2 focus:outline-none"
          />
        </div>

        {/* settings */}
        <div className="flex flex-col gap-6">
          <SectionLabel>تنظیمات</SectionLabel>
          {basic.map((c) => (
            <ControlField key={c.key} control={c} value={input[c.key]} onChange={setValue} />
          ))}

          {advanced.length > 0 && (
            <>
              <button
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex items-center justify-between text-[12.5px] text-ink2 active:scale-[0.99]"
              >
                <span>تنظیمات پیشرفته</span>
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
          onClick={() => onGenerate(prompt.trim(), input, variant)}
          disabled={!canGenerate}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3.5 text-[15px] font-semibold text-bg transition-all active:scale-[0.98] disabled:opacity-40"
        >
          <Sparkle size={18} weight="fill" />
          <span>ساخت</span>
          {price != null && (
            <span className="ms-1 flex items-center gap-1 rounded-full bg-bg/15 px-2.5 py-0.5 text-[12.5px]">
              <span>⬡</span>
              {faNum(price)}
            </span>
          )}
        </button>
        <div className="pt-1.5 text-center text-[10.5px] text-ink3">
          {price != null ? `حدود ${faNum(price)} سکه برای این تنظیمات` : "نرخِ این مدل هنوز وارد نشده"}
        </div>
      </div>
    </div>
  );
}

// keeps each upload slot's local preview state isolated and reset on variant change (via key)
function RefSlotField({ slotKey, label, max }: { slotKey: string; label: string; max: number }) {
  const [urls, setUrls] = useState<string[]>([]);
  return <RefUpload slot={{ key: slotKey, label, max }} urls={urls} onChange={setUrls} />;
}
