// Viral presets — a prompt someone already wrote, behind a picture.
//
// This is the entry point the catalog has been missing. A model list asks the
// user to know what a model is and to write a prompt; a preset asks them to
// pick a card. The reference leads its whole discovery page with fifty of
// these, and every one is a real prompt against a real model.
//
// `prompt` is complete on its own. Where the effect needs the user's subject,
// the sentence ends with a preposition and `openEnded` is true so the surface
// can drop the caret at the end rather than replacing the text.
//
// ContentRecord because this is the collection an admin adds to most often —
// see data/content.ts. Read it through `published()`, never raw.

import type { ContentRecord } from "./content";

export type PresetCategory = "camera" | "transform" | "vfx" | "portrait" | "product";

export const CATEGORY_LABEL: Record<PresetCategory, string> = {
  camera: "دوربین",
  transform: "دگرگونی",
  vfx: "جلوه‌ی ویژه",
  portrait: "پرتره",
  product: "محصول",
};

export interface Preset extends ContentRecord {
  /** Persian label burned across the card. */
  title: string;
  /** Which family runs it — presets are prompts, not models. */
  familyId: string;
  seed: string;
  prompt: string;
  /** The prompt expects the user to append their subject. */
  openEnded?: boolean;
  kind: "video" | "image";
  category: PresetCategory;
  badge?: string | undefined;
}

const T = Date.UTC(2026, 7, 1);
const row = (
  id: string,
  order: number,
  title: string,
  familyId: string,
  seed: string,
  kind: Preset["kind"],
  category: PresetCategory,
  prompt: string,
  badge?: string,
): Preset => ({
  id, order, title, familyId, seed, kind, category, prompt,
  openEnded: true, status: "published", updatedAt: T,
  ...(badge ? { badge } : {}),
});

export const PRESETS: Preset[] = [
  row("p1", 10, "زوم زمین", "seedance", "vgen-earthzoom", "video", "camera",
    "extreme continuous zoom out from a close-up, pulling back through the atmosphere until the whole planet fills frame, seamless, cinematic, of ", "پرطرفدار"),
  row("p2", 20, "مجسمه یخی", "seedance", "vgen-ice", "video", "transform",
    "subject slowly crystallising into translucent ice, frost creeping across the surface, cold rim light, shallow depth of field, of "),
  row("p3", 30, "چرخش ۳۶۰", "kling", "vgen-orbit", "video", "camera",
    "smooth 360 degree orbital camera move around the subject, locked framing, cinematic lens, even lighting, of "),
  row("p4", 40, "پرواز آزاد", "seedance", "vgen-freefall", "video", "camera",
    "subject in free fall against open sky, clothes and hair whipping in the wind, camera falling alongside, of "),
  row("p5", 50, "فرش قرمز", "kling", "vgen-redcarpet", "video", "vfx",
    "walking a red carpet under a storm of paparazzi flashes, shallow depth of field, glamour lighting, of "),
  row("p6", 60, "شهر نئون", "seedance", "vgen-neoncity", "video", "vfx",
    "slow dolly through a rain-slicked neon city street at night, reflective puddles, volumetric haze, of "),
  row("p7", 70, "دید در شب", "kling", "vgen-nightvision", "video", "vfx",
    "grainy green night-vision footage, handheld, slight sensor bloom, surveillance framing, of "),
  row("p8", 80, "برش مقوایی", "seedance", "vgen-cardboard", "video", "transform",
    "subject rendered as a flat cardboard cut-out animated in a real environment, stop-motion feel, of "),
  row("p9", 90, "پرترهٔ سینمایی", "nano-banana", "vgen-cineportrait", "image", "portrait",
    "cinematic portrait, dramatic rim lighting, 85mm, shallow depth of field, film grain, ultra detailed, of ", "پرطرفدار"),
  row("p10", 100, "محصول لاکچری", "seedream", "vgen-luxeproduct", "image", "product",
    "luxury product photography on white marble, soft studio lighting, elegant reflections, of "),
  row("p11", 110, "پوستر تایپوگرافی", "ideogram", "vgen-typoposter", "image", "product",
    "bold minimalist typographic poster, bauhaus grid, high contrast, the text reads "),
  row("p12", 120, "تبدیل به کارتون", "nano-banana", "vgen-toon", "image", "transform",
    "redraw as a clean 2D animation cel, flat colour, confident linework, expressive, of "),
  row("p13", 130, "عکس قدیمی", "seedream", "vgen-vintage", "image", "transform",
    "1970s film photograph, faded colour, halation, visible grain, slightly soft focus, of "),
  row("p14", 140, "مینیاتور ایزومتریک", "gpt-image", "vgen-iso", "image", "product",
    "isometric miniature diorama, tilt-shift, pastel palette, highly detailed, of "),
  row("p15", 150, "استودیوی سه‌بعدی", "flux", "vgen-3drender", "image", "product",
    "clean 3D render on a seamless backdrop, soft global illumination, subtle shadows, product-shot framing, of "),
  row("p16", 160, "نور طلایی", "nano-banana", "vgen-goldenhour", "image", "portrait",
    "golden hour backlight, warm haze, lens flare, soft skin falloff, of "),
  row("p17", 170, "انفجار", "seedance", "vgen-explosion", "video", "vfx",
    "slow motion explosion behind the subject, debris and embers, heat distortion, anamorphic, of "),
  row("p18", 180, "قاب سیاه‌وسفید", "seedream", "vgen-bw", "image", "portrait",
    "high contrast black and white portrait, hard key light, deep shadows, of "),
];
