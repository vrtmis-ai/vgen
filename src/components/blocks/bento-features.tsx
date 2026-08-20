"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";

import { ModelMark } from "@/components/ModelMark";
import { usePublishedContent } from "@/features/content/ContentProvider";
import { FAMILIES, getFamily, type Family } from "@/data/models";

import { isVideoUrl } from "@/lib/format";
import { useI18n, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* One compact, asymmetric product mosaic. Visuals fill every tile and the copy
   sits on top of them, keeping the whole ecosystem within one desktop viewport. */

const VIDEO_FAMILIES = FAMILIES.filter((family) => family.kind === "video");
const IMAGE_FAMILIES = FAMILIES.filter((family) => family.kind === "image");

const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function FamilyMedia({ familyId, className }: { familyId: string; className?: string }) {
  const family = getFamily(familyId);
  const [failed, setFailed] = useState(false);
  const cover = family?.cover;

  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: family?.grad ?? "var(--vg-surface-overlay)" }}>
      {cover && !failed && isVideoUrl(cover) ? (
        <video
          src={cover}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : cover && !failed ? (
        <img src={cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/20" />
    </div>
  );
}

function PlaceholderGraphic({ src, fallback, position = "center" }: { src: string; fallback: React.ReactNode; position?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "var(--vg-surface-overlay)" }}>
      {failed ? (
        fallback
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: position }}
          onError={() => setFailed(true)}
        />
      )}
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
}

function ModelPill({ family }: { family: Family }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1.5 text-[10.5px] font-semibold text-white"
      style={{ background: "rgb(9 9 9 / 0.72)", border: "1px solid rgb(255 255 255 / 0.14)", backdropFilter: "blur(12px)" }}
    >
      <ModelMark familyId={family.id} vendor={family.vendor} size={13} />
      <span lang="en">{family.name}</span>
    </span>
  );
}

function VideoGraphic() {
  const families = ["veo", "kling", "seedance"].map(getFamily).filter((family): family is Family => family != null);
  return (
    <div className="absolute inset-0">
      <FamilyMedia familyId="veo" className="absolute inset-0" />
      <div className="absolute inset-x-4 top-4 flex flex-wrap gap-1.5" dir="ltr">
        {families.map((family) => (
          <ModelPill key={family.id} family={family} />
        ))}
      </div>
      <div
        className="absolute inset-x-4 bottom-28 rounded-card p-3 md:inset-x-5"
        style={{ background: "rgb(9 9 9 / 0.72)", border: "1px solid rgb(255 255 255 / 0.12)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex items-center justify-between gap-3 text-[10.5px] text-white/70">
          <span>Text / Image → Video</span>
          <span className="tabular-nums">16:9 · 1080p</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-white/15">
            <span className="block h-full w-[68%] rounded-pill" style={{ background: "var(--vg-primary)" }} />
          </span>
          <span className="text-[10px] tabular-nums text-white/60">00:08</span>
        </div>
      </div>
    </div>
  );
}

function ImageGraphic() {
  const nano = getFamily("nano-banana");
  const gpt = getFamily("gpt-image");
  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-2 p-2.5">
      <FamilyMedia familyId="nano-banana" className="rounded-card" />
      <FamilyMedia familyId="gpt-image" className="rounded-card" />
      <div
        className="absolute inset-x-4 bottom-28 rounded-pill px-3.5 py-2.5 text-[11px] text-white"
        style={{ background: "rgb(9 9 9 / 0.76)", border: "1px solid rgb(255 255 255 / 0.14)", backdropFilter: "blur(16px)" }}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">یک پرتره‌ی سینمایی با نور نرم…</span>
          <span className="flex shrink-0 gap-1" dir="ltr">
            {nano && <ModelMark familyId={nano.id} vendor={nano.vendor} size={13} />}
            {gpt && <ModelMark familyId={gpt.id} vendor={gpt.vendor} size={13} />}
          </span>
        </span>
      </div>
    </div>
  );
}

function VoiceGraphic() {
  const voices = usePublishedContent().voices.slice(0, 3);
  return (
    <div className="absolute inset-0 flex flex-col justify-start gap-2.5 p-4 pb-24">
      <div className="flex h-20 items-center gap-[3px]" dir="ltr">
        {Array.from({ length: 46 }, (_, index) => {
          const height = 18 + ((index * 47 + index * index * 7) % 78);
          return (
            <span
              key={index}
              className="min-w-0 flex-1 rounded-pill"
              style={{ height: `${height}%`, background: "var(--vg-primary)", opacity: 0.22 + height / 150 }}
            />
          );
        })}
      </div>
      {voices.slice(0, 2).map((voice, index) => (
        <div
          key={voice.id}
          className="flex items-center gap-2.5 rounded-card px-3 py-2.5"
          style={{ background: "var(--vg-surface-raised)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
            style={{
              background: index === 0 ? "var(--vg-primary)" : "var(--vg-surface-overlay)",
              color: index === 0 ? "var(--vg-text-on-primary)" : "var(--vg-text)",
            }}
          >
            {index === 0 ? "▶" : "▷"}
          </span>
          <span className="min-w-0">
            <span className="block text-[11.5px] font-semibold" lang="en" style={{ color: "var(--vg-text)" }}>
              {voice.name}
            </span>
            <span className="block truncate text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
              {voice.note}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function EffectsGraphic() {
  const effects = usePublishedContent().presets.slice(0, 9);
  return (
    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1.5 p-2.5 pb-28">
      {effects.map((effect) => {
        const family = getFamily(effect.familyId);
        return (
          <div
            key={effect.id}
            className="relative overflow-hidden rounded-card"
            style={{ background: family?.grad ?? "var(--vg-surface-overlay)" }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/10" />
            <span className="absolute inset-x-0 bottom-0 px-2 pb-2 text-[9.5px] font-semibold leading-tight text-white">
              {effect.title}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AcademyGraphic() {
  const courses = usePublishedContent().courses.slice(0, 3);
  return (
    <div className="absolute inset-0 flex flex-col justify-start gap-1.5 p-3 pb-24">
      {courses.slice(0, 2).map((course) => (
        <div
          key={course.id}
          className="rounded-card p-2.5"
          style={{ background: "var(--vg-surface-raised)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
              {course.title}
            </span>
            <span className="shrink-0 text-[9.5px] tabular-nums" dir="ltr" style={{ color: "var(--vg-text-faint)" }}>
              {mmss(course.lessons.reduce((total, lesson) => total + lesson.seconds, 0))}
            </span>
          </div>
          <div className="mt-2.5 flex gap-1">
            {course.lessons.map((lesson) => (
              <span
                key={lesson.id}
                className="h-1 flex-1 rounded-pill"
                style={{ background: lesson.videoUrl ? "var(--vg-primary)" : "var(--vg-border)" }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudioGraphic() {
  const tabs = [
    { label: "ویدیو", family: getFamily("kling") },
    { label: "تصویر", family: getFamily("nano-banana") },
    { label: "صدا", family: getFamily("elevenlabs") },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-3">
      <div className="w-full rounded-card p-3.5" style={{ background: "var(--vg-surface-raised)", border: "1px solid var(--vg-border)" }}>
        <div className="flex gap-1 rounded-pill p-1" style={{ background: "var(--vg-canvas)" }}>
          {tabs.map(({ label, family }, index) => (
            <span
              key={label}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-pill py-2 text-[10.5px] font-semibold"
              style={{
                background: index === 0 ? "var(--vg-surface-overlay)" : "transparent",
                color: index === 0 ? "var(--vg-text)" : "var(--vg-text-faint)",
              }}
            >
              {family && <ModelMark familyId={family.id} vendor={family.vendor} size={12} />}
              {label}
            </span>
          ))}
        </div>
        <div
          className="mt-3 min-h-24 rounded-card p-3 text-[11.5px] leading-[1.9]"
          style={{ background: "var(--vg-canvas)", color: "var(--vg-text-muted)" }}
        >
          نمای نزدیک محصول روی میز سنگی، نور سینمایی، حرکت آرام دوربین…
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[10.5px] font-semibold" lang="en" style={{ color: "var(--vg-text-faint)" }}>
            DEEV Cinema Studio
          </span>
          <span
            className="rounded-pill px-3 py-1.5 text-[10.5px] font-bold"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            ساختن
          </span>
        </div>
      </div>
    </div>
  );
}

function McpGraphic() {
  return (
    <div className="absolute inset-0 flex items-start justify-end p-4" dir="ltr">
      <div
        className="flex items-center gap-2 rounded-card px-3 py-2"
        style={{ background: "rgb(9 9 9 / 0.62)", border: "1px solid rgb(255 255 255 / 0.13)", backdropFilter: "blur(14px)" }}
      >
        <span
          className="grid size-7 place-items-center rounded-full text-[16px]"
          style={{ background: "var(--vg-primary-a10)", color: "var(--vg-primary-soft)" }}
        >
          ✦
        </span>
        <span className="text-[11px] font-semibold text-white/80" lang="en">
          Claude × DEEV
        </span>
        <span
          className="rounded-pill px-2 py-1 text-[9px] font-bold"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          MCP
        </span>
      </div>
    </div>
  );
}

interface Card {
  key: string;
  eyebrow: TKey;
  title: TKey;
  description: TKey;
  counts?: { n?: number; m?: number };
  graphic: React.ReactNode;
  fade?: ("top" | "bottom")[];
  layout: string;
  short?: boolean;
}

const FEATURE_LOOK: Record<string, { rgb: string; hex: string }> = {
  video: { rgb: "19 185 255", hex: "#13b9ff" },
  image: { rgb: "128 111 255", hex: "#806fff" },
  voice: { rgb: "70 203 190", hex: "#46cbbe" },
  effects: { rgb: "255 57 126", hex: "#ff397e" },
  academy: { rgb: "244 185 104", hex: "#f4b968" },
  studio: { rgb: "255 108 82", hex: "#ff6c52" },
  mcp: { rgb: "174 120 255", hex: "#ae78ff" },
};

/**
 * A function rather than a constant, because one of the six counts is no longer
 * knowable at module scope: the voice list is served, not imported, so it
 * arrives through a hook inside the component below. The other five still come
 * from FAMILIES, which is the catalogue and a separate move.
 */
const cards = (voiceCount: number): Card[] => [
  {
    key: "video",
    layout: "sm:min-h-[360px] lg:col-start-2 lg:row-start-1 lg:row-span-4 lg:min-h-0",
    eyebrow: "lp_bento_video",
    title: "lp_bento_video_t",
    description: "lp_bento_video_d",
    counts: { n: VIDEO_FAMILIES.length },
    graphic: <PlaceholderGraphic src="/features/placeholders/ai-video.png" fallback={<VideoGraphic />} position="center 42%" />,
  },
  {
    key: "image",
    layout: "sm:min-h-[360px] lg:col-start-1 lg:row-start-1 lg:row-span-4 lg:min-h-0",
    eyebrow: "lp_bento_image",
    title: "lp_bento_image_t",
    description: "lp_bento_image_d",
    counts: { n: IMAGE_FAMILIES.length },
    graphic: <PlaceholderGraphic src="/features/placeholders/ai-image.png" fallback={<ImageGraphic />} position="center 38%" />,
  },
  {
    key: "voice",
    layout: "sm:min-h-[220px] lg:col-start-1 lg:row-start-5 lg:row-span-2 lg:min-h-0",
    short: true,
    eyebrow: "lp_bento_voice",
    title: "lp_bento_voice_t",
    description: "lp_bento_voice_d",
    counts: { n: voiceCount },
    graphic: <PlaceholderGraphic src="/features/placeholders/ai-voice.png" fallback={<VoiceGraphic />} />,
  },
  {
    key: "effects",
    layout: "sm:min-h-[580px] lg:col-start-3 lg:row-start-1 lg:row-span-6 lg:min-h-0",
    eyebrow: "lp_bento_effects",
    title: "lp_bento_effects_t",
    description: "lp_bento_effects_d",
    graphic: <PlaceholderGraphic src="/features/placeholders/effects.png" fallback={<EffectsGraphic />} position="center 36%" />,
  },
  {
    key: "academy",
    layout: "sm:min-h-[220px] lg:col-start-2 lg:row-start-5 lg:row-span-2 lg:min-h-0",
    short: true,
    eyebrow: "lp_bento_academy",
    title: "lp_bento_academy_t",
    description: "lp_bento_academy_d",
    graphic: <PlaceholderGraphic src="/features/placeholders/academy.png" fallback={<AcademyGraphic />} />,
  },
  {
    key: "studio",
    layout: "sm:min-h-[360px] lg:col-start-4 lg:row-start-3 lg:row-span-4 lg:min-h-0",
    eyebrow: "lp_bento_studio",
    title: "lp_bento_studio_t",
    description: "lp_bento_studio_d",
    graphic: <PlaceholderGraphic src="/features/placeholders/studio.png" fallback={<StudioGraphic />} position="center 42%" />,
  },
  {
    key: "mcp",
    layout: "sm:min-h-[220px] lg:col-start-4 lg:row-start-1 lg:row-span-2 lg:min-h-0",
    short: true,
    eyebrow: "lp_bento_mcp",
    title: "lp_bento_mcp_t",
    description: "lp_bento_mcp_d",
    graphic: <PlaceholderGraphic src="/features/placeholders/mcp.png" fallback={<McpGraphic />} />,
  },
];

export function FeaturesBento() {
  const { t, n } = useI18n();
  // The full list, not the three the voice panel shows — this is the count the
  // card advertises.
  const voiceCount = usePublishedContent().voices.length;
  const description = (card: Card) =>
    card.counts
      ? t(card.description)
          .replace("{n}", card.counts.n == null ? "" : n(card.counts.n))
          .replace("{m}", card.counts.m == null ? "" : n(card.counts.m))
      : t(card.description);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:h-[610px] lg:grid-cols-4 lg:grid-rows-6">
      {cards(voiceCount).map((card, index) => (
        <BentoCard
          key={card.key}
          dataFeature={card.key}
          serial={String(index + 1).padStart(2, "0")}
          className={card.layout}
          short={card.short ?? false}
          eyebrow={t(card.eyebrow)}
          title={t(card.title)}
          description={description(card)}
          graphic={card.graphic}
          tone={FEATURE_LOOK[card.key]!}
          {...(card.fade ? { fade: card.fade } : {})}
        />
      ))}
    </div>
  );
}

export function BentoCard({
  className = "",
  dataFeature,
  serial,
  eyebrow,
  title,
  description,
  graphic,
  tone,
  fade = [],
  short = false,
}: {
  className?: string;
  dataFeature?: string;
  serial?: string;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  graphic?: React.ReactNode;
  tone: { rgb: string; hex: string };
  fade?: ("top" | "bottom")[];
  short?: boolean;
}) {
  return (
    <motion.article
      data-testid={dataFeature ? `feature-card-${dataFeature}` : undefined}
      id={dataFeature ? `feature-${dataFeature}` : undefined}
      initial="idle"
      whileHover="active"
      variants={{
        idle: {
          y: 0,
          borderColor: "rgb(255 255 255 / 0.1)",
          boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.055), 0 26px 80px -58px rgb(${tone.rgb} / 0.45)`,
        },
        active: {
          y: -5,
          borderColor: `rgb(${tone.rgb} / 0.38)`,
          boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.1), 0 34px 90px -46px rgb(${tone.rgb} / 0.5)`,
        },
      }}
      transition={{ type: "spring", stiffness: 260, damping: 25, mass: 0.7 }}
      className={cn("group relative min-h-[240px] scroll-mt-24 overflow-hidden rounded-[26px] border transform-gpu", className)}
      style={{
        background: "rgb(15 15 16)",
      }}
    >
      <motion.div
        className="absolute inset-[1px] overflow-hidden rounded-[24px]"
        variants={{ idle: { scale: 1 }, active: { scale: 1.035 } }}
        transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden
      >
        {graphic}
        {fade.includes("top") && <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent" />}
        {fade.includes("bottom") && <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />}
      </motion.div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-[1px] rounded-[24px] opacity-60 mix-blend-soft-light"
        style={{
          backgroundImage:
            "repeating-linear-gradient(118deg, rgb(255 255 255 / 0.025) 0, rgb(255 255 255 / 0.025) 1px, transparent 1px, transparent 5px)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 112%, rgb(${tone.rgb} / 0.18), transparent 40%), linear-gradient(to top, rgb(5 5 6 / 0.98) 0%, rgb(5 5 6 / 0.78) 28%, rgb(5 5 6 / 0.12) 67%, rgb(5 5 6 / 0.08) 100%)`,
        }}
      />

      <div className="absolute inset-x-3 top-3 z-30 flex items-center justify-between gap-3">
        <span
          className="inline-flex min-w-0 items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-[9.5px] font-semibold backdrop-blur-xl"
          style={{
            color: "rgb(255 255 255 / 0.84)",
            background: "rgb(8 8 9 / 0.48)",
            borderColor: "rgb(255 255 255 / 0.12)",
            boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.07), 0 10px 24px -18px rgb(0 0 0 / 0.9)",
          }}
        >
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone.hex, boxShadow: `0 0 10px rgb(${tone.rgb} / 0.9)` }} />
          <span className="truncate">{eyebrow}</span>
        </span>
        {serial && (
          <span className="font-mono text-[9px] tracking-[0.18em] text-white/42" dir="ltr">
            DEEV / {serial}
          </span>
        )}
      </div>

      <motion.div
        variants={{ idle: { y: 0 }, active: { y: -3 } }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className={cn("absolute inset-x-0 bottom-0 isolate z-20 p-5 md:p-6", short && "md:p-5")}
      >
        <h3
          className={cn(
            "max-w-[18ch] text-balance text-[20px] font-bold leading-[1.32] tracking-[-0.025em] text-white md:text-[24px]",
            short && "md:text-[19px]",
          )}
          style={{ fontFamily: "var(--vg-font-display)" }}
        >
          {title}
        </h3>
        <p className={cn("mt-2.5 max-w-[40ch] text-[11.5px] leading-[1.85] text-white/62", short ? "line-clamp-2" : "line-clamp-3")}>
          {description}
        </p>
        <motion.span
          aria-hidden
          className="mt-4 block h-px"
          style={{ background: `linear-gradient(90deg, rgb(${tone.rgb} / 0.95), rgb(${tone.rgb} / 0.12), transparent)` }}
          variants={{ idle: { width: 34, opacity: 0.7 }, active: { width: 74, opacity: 1 } }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
      </motion.div>

      <span aria-hidden className="pointer-events-none absolute inset-[1px] rounded-[24px] ring-1 ring-inset ring-white/[0.055]" />
    </motion.article>
  );
}
