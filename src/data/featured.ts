// Curated "ویژه" spotlight on Home: new models, new features, and crafted templates.
// We control this — it's where new model drops, new app features, and ready-made
// effect/templates go. Tapping a model/template opens it (templates pre-fill the prompt).

export type FeaturedKind = "model" | "template" | "feature";

export interface FeaturedItem {
  id: string;
  kind: FeaturedKind;
  title: string;
  subtitle: string;
  seed: string; // picsum thumbnail seed (placeholder art until real previews)
  familyId?: string; // model/template open target
  prompt?: string; // template: user appends their subject after this
}

export const FEATURED: FeaturedItem[] = [
  { id: "f1", kind: "model", title: "Veo 3.1", subtitle: "ویدیوی سینماییِ گوگل — تازه اضافه شد", seed: "vgen-veo", familyId: "veo" },
  { id: "f2", kind: "feature", title: "عکس به ویدیو", subtitle: "تصویرتو با Seedance یا Kling زنده کن", seed: "vgen-i2v", familyId: "seedance" },
  { id: "f3", kind: "template", title: "پرترهٔ سینمایی", subtitle: "تمپلیتِ آماده — فقط سوژه‌تو اضافه کن", seed: "vgen-portrait", familyId: "nano-banana", prompt: "cinematic portrait, dramatic rim lighting, 85mm, shallow depth of field, ultra detailed, of " },
  { id: "f4", kind: "template", title: "عکسِ محصولِ لاکچری", subtitle: "محصول روی مرمر با نورِ استودیویی", seed: "vgen-product", familyId: "seedream", prompt: "luxury product photography on white marble, soft studio lighting, elegant reflections, of " },
  { id: "f5", kind: "model", title: "Nano Banana 2", subtitle: "نسلِ جدیدِ تصویرِ گوگل", seed: "vgen-nb2", familyId: "nano-banana" },
  { id: "f6", kind: "template", title: "پوسترِ تایپوگرافی", subtitle: "متن و لوگوی تمیز با Ideogram", seed: "vgen-poster2", familyId: "ideogram", prompt: "bold minimalist typographic poster, bauhaus grid, high contrast, the text reads " },
];
