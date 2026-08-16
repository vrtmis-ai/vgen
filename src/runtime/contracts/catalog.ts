import { z } from "zod";

const OptionSchema = z.object({ value: z.string(), label: z.string() });
const AspectOptionSchema = OptionSchema.extend({ w: z.number().positive(), h: z.number().positive() });
const AdvancedSchema = z.object({ advanced: z.boolean().optional() });

export const ControlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("aspect"),
    key: z.string().min(1),
    label: z.string(),
    options: z.array(AspectOptionSchema).min(1),
    def: z.string(),
  }),
  AdvancedSchema.extend({
    kind: z.literal("segment"),
    key: z.string().min(1),
    label: z.string(),
    options: z.array(OptionSchema).min(1),
    def: z.string(),
  }),
  AdvancedSchema.extend({
    kind: z.literal("slider"),
    key: z.string().min(1),
    label: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    def: z.number(),
    unit: z.string().optional(),
    asString: z.boolean().optional(),
  }).refine((control) => control.max >= control.min && control.def >= control.min && control.def <= control.max, {
    message: "Slider default must be inside its range",
  }),
  AdvancedSchema.extend({ kind: z.literal("toggle"), key: z.string().min(1), label: z.string(), def: z.boolean() }),
  AdvancedSchema.extend({
    kind: z.literal("text"),
    key: z.string().min(1),
    label: z.string(),
    placeholder: z.string().optional(),
  }),
  AdvancedSchema.extend({ kind: z.literal("voice"), key: z.string().min(1), label: z.string(), def: z.string() }),
]);

export const RefSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  max: z.number().int().positive(),
  media: z.enum(["image", "video", "audio"]).optional(),
  maxMb: z.number().positive().optional(),
  required: z.boolean().optional(),
  requires: z.string().min(1).optional(),
});

export const VariantSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  /** `features.code` — the product section a job from this variant is filed under. */
  featureCode: z.string().min(1),
  modelWithRefs: z.string().min(1).optional(),
  maxPrompt: z.number().int().positive().optional(),
  label: z.string(),
  badge: z.string().optional(),
  refs: z.array(RefSlotSchema).nullable().optional(),
  controls: z.array(ControlSchema).optional(),
});

export const FamilySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().min(1),
  kind: z.enum(["image", "video", "audio"]),
  /** Lowest `plans.tier` that may run this family. Never defaulted — an absent tier locks. */
  minTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  blurb: z.string(),
  badge: z.string().optional(),
  grad: z.string(),
  cover: z.string().url().optional(),
  refs: z.array(RefSlotSchema).optional(),
  maxPrompt: z.number().int().positive().optional(),
  noPrompt: z.boolean().optional(),
  controls: z.array(ControlSchema),
  variants: z.array(VariantSchema).min(1),
});

export const CatalogSnapshotSchema = z.object({
  version: z.string().min(1),
  publishedAt: z.number().int().nonnegative(),
  families: z.array(FamilySchema),
});

export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
