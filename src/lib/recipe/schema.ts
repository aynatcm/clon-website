import { z } from "zod";

/**
 * Phase 7.5 — Section Recipes + Content DNA.
 *
 * A Section Recipe is a COMPLETE structural template captured from the source
 * site: column count, media placement, CTA count, card structure, spacing and
 * an ordered list of content slots. Generation INSTANTIATES the recipe verbatim
 * — AI may only fill the content slots. Layout/hierarchy/spacing/CTA-count/
 * media-placement/card-structure all come from the recipe, never from a prompt.
 */

export const SlotKind = z.enum([
  "eyebrow",
  "heading",
  "subheading",
  "body",
  "cta",
  "media",
  "cardGroup",
  "statGroup",
  "logoGroup",
  "form",
]);

export const SlotSpecSchema = z.object({
  id: z.string(),
  kind: SlotKind,
  level: z.number().optional(), // heading level (1-4)
  maxChars: z.number().optional(),
  count: z.number().optional(), // for groups (cards/stats/logos) or repeated CTAs
});

export const CardRecipeSchema = z.object({
  count: z.number().default(3),
  hasIcon: z.boolean().default(false),
  hasCta: z.boolean().default(false),
  slots: z.array(z.string()).default(["heading", "body"]), // per-card slot order
});

export const SectionRecipeSchema = z.object({
  id: z.string(),
  type: z.string(), // detected section type
  variant: z.string(), // split | grid | centered | form | logos | stacked | media
  frequency: z.number().default(1),
  columns: z.number().default(1),
  mediaPlacement: z.enum(["left", "right", "top", "bottom", "background", "none"]).default("none"),
  ctaCount: z.number().default(0),
  alignment: z.enum(["left", "center", "right"]).default("left"),
  spacing: z.object({ top: z.string(), bottom: z.string(), gap: z.string() }),
  card: CardRecipeSchema.optional(),
  slots: z.array(SlotSpecSchema), // ordered content slots to fill
  background: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});

/** Content DNA — how the brand structures copy per slot. */
export const ContentPatternSchema = z.object({
  headline: z.object({ avgWords: z.number(), style: z.string(), casing: z.string() }),
  subheadline: z.object({ avgWords: z.number() }),
  cta: z.object({ labels: z.array(z.string()).default([]), verbLed: z.boolean().default(true) }),
  feature: z.object({ naming: z.string(), hasIcon: z.boolean().default(false), bodyWords: z.number() }),
  vocabulary: z.array(z.string()).default([]),
});

export const RecipeBookSchema = z.object({
  recipes: z.array(SectionRecipeSchema).default([]),
  contentPattern: ContentPatternSchema,
});

export type SlotSpec = z.infer<typeof SlotSpecSchema>;
export type CardRecipe = z.infer<typeof CardRecipeSchema>;
export type SectionRecipe = z.infer<typeof SectionRecipeSchema>;
export type ContentPattern = z.infer<typeof ContentPatternSchema>;
export type RecipeBook = z.infer<typeof RecipeBookSchema>;

/** Filled slot values produced by the (AI-only-content) slot-fill step. */
export type SlotValues = Record<string, string | string[]>;
