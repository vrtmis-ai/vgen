import { z } from "zod";

const OptionSchema = z.object({ value: z.string(), label: z.string() });
const AspectOptionSchema = OptionSchema.extend({ w: z.number().positive(), h: z.number().positive() });
const AdvancedSchema = z.object({ advanced: z.boolean().optional() });

export const CatalogControlSchema = z.discriminatedUnion("kind", [
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

export const CatalogRefSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  max: z.number().int().positive(),
  media: z.enum(["image", "video", "audio"]).optional(),
  maxMb: z.number().positive().optional(),
  required: z.boolean().optional(),
  requires: z.string().min(1).optional(),
});

/**
 * A variant as the shop describes it.
 *
 * **No upstream endpoint, by design.** `/api/v1/catalog` is unauthenticated, so
 * anything on this schema is public to anyone with curl. It used to carry
 * `model` and `modelWithRefs` — the exact strings our supplier expects — which
 * named the supplier to every visitor. The browser never read either: a
 * customer picks by `id`, and the price and the job both key off that.
 *
 * The ids are not merely omitted from the response, they are kept out of the
 * `capabilities` blob this is parsed from (`scripts/publish-catalog.ts`) and out
 * of `models.ts` entirely. A schema that dropped a field the row still carried
 * would put it one `.passthrough()` away from being public again.
 */
export const CatalogVariantSchema = z.object({
  id: z.string().min(1),
  /** `features.code` — the product section a job from this variant is filed under. */
  featureCode: z.string().min(1),
  maxPrompt: z.number().int().positive().optional(),
  label: z.string(),
  badge: z.string().optional(),
  refs: z.array(CatalogRefSlotSchema).nullable().optional(),
  controls: z.array(CatalogControlSchema).optional(),
});

export const CatalogFamilySchema = z.object({
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
  refs: z.array(CatalogRefSlotSchema).optional(),
  maxPrompt: z.number().int().positive().optional(),
  noPrompt: z.boolean().optional(),
  controls: z.array(CatalogControlSchema),
  variants: z.array(CatalogVariantSchema).min(1),
});

/**
 * What `provider_models.capabilities` holds, and the contract between the
 * seeder that writes it (scripts/publish-catalog.ts) and the repository that
 * reads it back.
 *
 * A variant's row carries its whole family because provider_models has no
 * family table to point at. The seeder is the only writer, so the copies cannot
 * disagree; the repository takes the family from the first row of each group.
 *
 * The order fields are not decoration. The studio screens are ordered lists,
 * a table is a set, and without them the model switcher reshuffles itself
 * whenever the planner picks a different index.
 */
export const CatalogCapabilitiesSchema = z.object({
  familyOrder: z.number().int().nonnegative(),
  variantOrder: z.number().int().nonnegative(),
  family: CatalogFamilySchema.omit({ variants: true }),
  variant: CatalogVariantSchema,
});

export const CatalogSnapshotSchema = z.object({
  version: z.string().min(1),
  publishedAt: z.number().int().nonnegative(),
  families: z.array(CatalogFamilySchema),
});

export type CatalogFamily = z.infer<typeof CatalogFamilySchema>;
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
