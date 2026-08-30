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

/**
 * A variant as the shop describes it.
 *
 * **No upstream endpoint, by design.** `/api/v1/catalog` is unauthenticated, so
 * anything here is public to anyone with curl. It used to carry `model` and
 * `modelWithRefs` — the exact strings our supplier expects — which named the
 * supplier to every visitor. The browser never read either: a customer picks by
 * `id`, and the price and the job both key off that. The mapping now lives in
 * `src/data/upstream.json`, which only the seeders may import.
 */
/**
 * The unlimited pipe, when a variant has one.
 *
 * Some models are reachable two ways: metered, which bills per image and is
 * quick, and a flat-fee subscription reached through a gateway, which bills
 * nothing per image and throttles into a slower queue past a daily per-account
 * threshold. `scripts/publish-unlimited.ts` seeds the second; this is the only
 * thing about it a browser is told.
 *
 * **On the variant, not the family.** A grant is per catalogue row, so Nano
 * Banana can have the pipe for Pro and for 2 while a sibling variant does not.
 * A family-level flag would promise it on a variant that cannot deliver.
 *
 * Deliberately not a second catalogue entry either. The customer picks one Nano
 * Banana Pro and then chooses how it is served; two entries would make them
 * choose between models they cannot tell apart, and would double every price
 * table.
 *
 * **Derived, never seeded.** Every field here is read from
 * `unlimited_entitlements` when the catalogue document is built — the same row
 * the quote path checks and the same row that authorises a free job. Publishing
 * a copy of it into `capabilities` would create a second place for the answer
 * to live, and the two would disagree the first time a grant was retired: the
 * shop would go on advertising a free pipe that the quote had stopped granting.
 *
 * All three fields are public in the sense a price is public. What none of them
 * says is whether *you* get it — that depends on your plan and on what you have
 * spent today, and only the quote can answer it.
 */
const UnlimitedPipeSchema = z.object({
  /**
   * Free generations per account per day.
   *
   * What is *left* of today comes back on the quote instead, because only the
   * server knows what has been spent. This is the number a screen uses to say
   * what the choice is worth before it is made.
   */
  dailyCap: z.number().int().positive().nullable(),
  /**
   * Lowest `plans.tier` the grant is open to.
   *
   * Present so a screen can offer the upgrade rather than a switch that fails.
   * Without it the pipe looks available to everybody, and a customer on the
   * wrong plan flips something labelled free and is charged the metered price —
   * a money surprise, and the quote declining politely does not undo it.
   */
  minTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /**
   * `control key -> the values the pipe covers`. Absent means all of them.
   *
   * The subscription does not necessarily serve every setting the metered
   * provider does. A setting outside this is priced the ordinary way, so the
   * screen has to be able to say so *before* the choice rather than after a
   * quote comes back with a number on it.
   *
   * A key absent from the object is unconstrained, so adding a control to a
   * variant never silently narrows an existing grant.
   */
  limits: z.record(z.string(), z.array(z.string().min(1))).optional(),
});

export const VariantSchema = z.object({
  id: z.string().min(1),
  /** `features.code` — the product section a job from this variant is filed under. */
  featureCode: z.string().min(1),
  maxPrompt: z.number().int().positive().optional(),
  label: z.string(),
  badge: z.string().optional(),
  /** Absent for the variants served only by the metered pipe. */
  unlimited: UnlimitedPipeSchema.optional(),
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
