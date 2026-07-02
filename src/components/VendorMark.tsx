// Small brand mark (monogram) per model vendor. A safe, consistent stand-in for
// real brand logos (trademarked logos aren't ours to ship). Swappable later.

const VENDORS: Record<string, { m: string; c: string }> = {
  Google: { m: "G", c: "#4285F4" },
  OpenAI: { m: "O", c: "#10A37F" },
  ByteDance: { m: "B", c: "#3B82F6" },
  "Black Forest Labs": { m: "F", c: "#8B5CF6" },
  Alibaba: { m: "A", c: "#FF6A00" },
  Ideogram: { m: "I", c: "#EC4899" },
  Kuaishou: { m: "K", c: "#F97316" },
  MiniMax: { m: "M", c: "#F43F5E" },
  xAI: { m: "X", c: "#A1A1AA" },
  Tongyi: { m: "T", c: "#6366F1" },
};

export function VendorMark({ vendor, size = 22 }: { vendor: string; size?: number }) {
  const v = VENDORS[vendor] ?? { m: vendor.slice(0, 1).toUpperCase(), c: "#71717A" };
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-white/20"
      style={{ width: size, height: size, background: v.c, fontSize: Math.round(size * 0.46) }}
      aria-label={vendor}
    >
      {v.m}
    </span>
  );
}
