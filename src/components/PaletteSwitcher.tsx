"use client";

/**
 * TEMPORARY — a floating control for judging the four brand directions on the
 * real product instead of on a swatch sheet.
 *
 * DELETE THIS FILE once a direction is picked, along with
 * design-system/palette-preview.css, its @import in index.css, and the mount
 * in app/layout.tsx.
 *
 * Demo-mode only, and the guard is a build-time constant rather than a runtime
 * check: Next inlines `process.env.NEXT_PUBLIC_APP_MODE` literally, so in a
 * production build the condition folds to false and the whole component is
 * dropped from the bundle. It cannot ship by accident.
 */

import { useEffect, useState } from "react";

const DIRECTIONS = [
  { id: "blue", label: "۲ · آبی", swatch: "#00b1fe", note: "هویت فعلی، تیزشده" },
  { id: "lime", label: "۱ · لایم", swatch: "#c6f52e", note: "نزدیک به رفرنس" },
  { id: "violet", label: "۳ · بنفش", swatch: "#a97bff", note: "سینمایی" },
  { id: "ember", label: "۴ · اخرا", swatch: "#ff6b2c", note: "نارنجی اصلی" },
] as const;

type DirectionId = (typeof DIRECTIONS)[number]["id"];

const PALETTE_KEY = "vgen:preview-palette";
const SURFACE_KEY = "vgen:preview-surface";

export function PaletteSwitcher() {
  const [palette, setPalette] = useState<DirectionId>("blue");
  const [cool, setCool] = useState(false);
  const [open, setOpen] = useState(true);

  // Read once on mount rather than in useState's initialiser: this renders on
  // the server too, and localStorage does not exist there.
  useEffect(() => {
    const saved = localStorage.getItem(PALETTE_KEY);
    if (saved && DIRECTIONS.some((d) => d.id === saved)) setPalette(saved as DirectionId);
    setCool(localStorage.getItem(SURFACE_KEY) === "cool");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem(PALETTE_KEY, palette);
  }, [palette]);

  useEffect(() => {
    if (cool) document.documentElement.dataset.surface = "cool";
    else delete document.documentElement.dataset.surface;
    localStorage.setItem(SURFACE_KEY, cool ? "cool" : "neutral");
  }, [cool]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="نمایش انتخابگر پالت"
        style={{ ...shell, width: 44, height: 44, padding: 0, display: "grid", placeItems: "center", fontSize: 18 }}
      >
        ◐
      </button>
    );
  }

  return (
    <aside style={shell} dir="rtl">
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <strong style={{ fontSize: 11, letterSpacing: "0.06em", color: "#9fa4ad", fontWeight: 700 }}>پالت — موقت</strong>
        <button onClick={() => setOpen(false)} aria-label="بستن" style={iconBtn}>
          ×
        </button>
      </header>

      <div style={{ display: "grid", gap: 5 }}>
        {DIRECTIONS.map((d) => {
          const active = palette === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setPalette(d.id)}
              style={{
                ...row,
                background: active ? "rgba(255,255,255,0.09)" : "transparent",
                borderColor: active ? d.swatch : "rgba(255,255,255,0.08)",
              }}
            >
              <span style={{ width: 13, height: 13, borderRadius: 4, background: d.swatch, flexShrink: 0 }} />
              <span style={{ display: "grid", textAlign: "start", lineHeight: 1.35 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f4f5f7" }}>{d.label}</span>
                <span style={{ fontSize: 10, color: "#8c919b" }}>{d.note}</span>
              </span>
            </button>
          );
        })}
      </div>

      <label style={{ ...row, marginTop: 9, cursor: "pointer", borderColor: cool ? "#7fd0ff" : "rgba(255,255,255,0.08)" }}>
        <input type="checkbox" checked={cool} onChange={(e) => setCool(e.target.checked)} style={{ accentColor: "#7fd0ff" }} />
        <span style={{ display: "grid", textAlign: "start", lineHeight: 1.35 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#f4f5f7" }}>سطوح سرد</span>
          <span style={{ fontSize: 10, color: "#8c919b" }}>مستقل از رنگ</span>
        </span>
      </label>
    </aside>
  );
}

const shell: React.CSSProperties = {
  position: "fixed",
  insetBlockEnd: 16,
  insetInlineStart: 16,
  zIndex: 9999,
  width: 208,
  padding: 12,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(14,16,18,0.94)",
  backdropFilter: "blur(12px)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
  fontFamily: "Vazirmatn, system-ui, sans-serif",
  color: "#f4f5f7",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  width: "100%",
  padding: "7px 9px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
};

const iconBtn: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "#8c919b",
  cursor: "pointer",
  fontSize: 17,
  lineHeight: 1,
  padding: 0,
};
