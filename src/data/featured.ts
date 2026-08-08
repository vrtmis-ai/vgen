// Curated "ویژه" shelf on Explore: new models, new features, and crafted
// templates. We control this — it's where model drops, feature launches and
// ready-made effect templates go. Tapping a model/template opens it (templates
// pre-fill the prompt).
//
// ContentRecord because this is the shelf that changes most often and for the
// least technical reason: a model launches, a campaign starts, an item is
// pulled. None of that should need a deploy. Read it through `published()`.

import type { ContentRecord } from "./content";

export type FeaturedKind = "model" | "template" | "feature";

export interface FeaturedItem extends ContentRecord {
  kind: FeaturedKind;
  title: string;
  subtitle: string;
  seed: string; // picsum thumbnail seed (placeholder art until real previews)
  familyId?: string | undefined; // model/template open target
  prompt?: string | undefined; // template: user appends their subject after this
}

const T = Date.UTC(2026, 7, 1);

export const FEATURED: FeaturedItem[] = [
  { id: "f1", status: "published", order: 10, updatedAt: T, kind: "model", title: "Veo 3.1", subtitle: "ویدیوی سینماییِ گوگل — تازه اضافه شد", seed: "vgen-veo", familyId: "veo" },
  { id: "f2", status: "published", order: 20, updatedAt: T, kind: "feature", title: "عکس به ویدیو", subtitle: "تصویرتو با Seedance یا Kling زنده کن", seed: "vgen-i2v", familyId: "seedance" },
  { id: "f3", status: "published", order: 30, updatedAt: T, kind: "template", title: "پرترهٔ سینمایی", subtitle: "تمپلیتِ آماده — فقط سوژه‌تو اضافه کن", seed: "vgen-portrait", familyId: "nano-banana", prompt: "cinematic portrait, dramatic rim lighting, 85mm, shallow depth of field, ultra detailed, of " },
  { id: "f4", status: "published", order: 40, updatedAt: T, kind: "template", title: "عکسِ محصولِ لاکچری", subtitle: "محصول روی مرمر با نورِ استودیویی", seed: "vgen-product", familyId: "seedream", prompt: "luxury product photography on white marble, soft studio lighting, elegant reflections, of " },
  { id: "f5", status: "published", order: 50, updatedAt: T, kind: "model", title: "Nano Banana 2", subtitle: "نسلِ جدیدِ تصویرِ گوگل", seed: "vgen-nb2", familyId: "nano-banana" },
  { id: "f6", status: "published", order: 60, updatedAt: T, kind: "template", title: "پوسترِ تایپوگرافی", subtitle: "متن و لوگوی تمیز با Ideogram", seed: "vgen-poster2", familyId: "ideogram", prompt: "bold minimalist typographic poster, bauhaus grid, high contrast, the text reads " },
];
