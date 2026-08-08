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

export interface Preset {
  id: string;
  /** Persian label burned across the card. */
  title: string;
  /** Which family runs it — presets are prompts, not models. */
  familyId: string;
  seed: string;
  prompt: string;
  /** The prompt expects the user to append their subject. */
  openEnded?: boolean;
  tag: "video" | "image";
}

export const PRESETS: Preset[] = [
  { id: "p1", title: "زوم زمین", familyId: "seedance", seed: "vgen-earthzoom", tag: "video",
    prompt: "extreme continuous zoom out from a close-up, pulling back through the atmosphere until the whole planet fills frame, seamless, cinematic, of " , openEnded: true },
  { id: "p2", title: "مجسمه یخی", familyId: "seedance", seed: "vgen-ice", tag: "video",
    prompt: "subject slowly crystallising into translucent ice, frost creeping across the surface, cold rim light, shallow depth of field, of ", openEnded: true },
  { id: "p3", title: "چرخش ۳۶۰", familyId: "kling", seed: "vgen-orbit", tag: "video",
    prompt: "smooth 360 degree orbital camera move around the subject, locked framing, cinematic lens, even lighting, of ", openEnded: true },
  { id: "p4", title: "پرواز آزاد", familyId: "seedance", seed: "vgen-freefall", tag: "video",
    prompt: "subject in free fall against open sky, clothes and hair whipping in the wind, camera falling alongside, of ", openEnded: true },
  { id: "p5", title: "فرش قرمز", familyId: "kling", seed: "vgen-redcarpet", tag: "video",
    prompt: "walking a red carpet under a storm of paparazzi flashes, shallow depth of field, glamour lighting, of ", openEnded: true },
  { id: "p6", title: "شهر نئون", familyId: "seedance", seed: "vgen-neoncity", tag: "video",
    prompt: "slow dolly through a rain-slicked neon city street at night, reflective puddles, volumetric haze, of ", openEnded: true },
  { id: "p7", title: "دید در شب", familyId: "kling", seed: "vgen-nightvision", tag: "video",
    prompt: "grainy green night-vision footage, handheld, slight sensor bloom, surveillance framing, of ", openEnded: true },
  { id: "p8", title: "برش مقوایی", familyId: "seedance", seed: "vgen-cardboard", tag: "video",
    prompt: "subject rendered as a flat cardboard cut-out animated in a real environment, stop-motion feel, of ", openEnded: true },
  { id: "p9", title: "پرترهٔ سینمایی", familyId: "nano-banana", seed: "vgen-cineportrait", tag: "image",
    prompt: "cinematic portrait, dramatic rim lighting, 85mm, shallow depth of field, film grain, ultra detailed, of ", openEnded: true },
  { id: "p10", title: "محصول لاکچری", familyId: "seedream", seed: "vgen-luxeproduct", tag: "image",
    prompt: "luxury product photography on white marble, soft studio lighting, elegant reflections, of ", openEnded: true },
  { id: "p11", title: "پوستر تایپوگرافی", familyId: "ideogram", seed: "vgen-typoposter", tag: "image",
    prompt: "bold minimalist typographic poster, bauhaus grid, high contrast, the text reads ", openEnded: true },
  { id: "p12", title: "تبدیل به کارتون", familyId: "nano-banana", seed: "vgen-toon", tag: "image",
    prompt: "redraw as a clean 2D animation cel, flat colour, confident linework, expressive, of ", openEnded: true },
  { id: "p13", title: "عکس قدیمی", familyId: "seedream", seed: "vgen-vintage", tag: "image",
    prompt: "1970s film photograph, faded colour, halation, visible grain, slightly soft focus, of ", openEnded: true },
  { id: "p14", title: "مینیاتور ایزومتریک", familyId: "gpt-image", seed: "vgen-iso", tag: "image",
    prompt: "isometric miniature diorama, tilt-shift, pastel palette, highly detailed, of ", openEnded: true },
  { id: "p15", title: "استودیوی سه‌بعدی", familyId: "flux", seed: "vgen-3drender", tag: "image",
    prompt: "clean 3D render on a seamless backdrop, soft global illumination, subtle shadows, product-shot framing, of ", openEnded: true },
];
