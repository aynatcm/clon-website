import { z } from "zod";

/**
 * Phase 6.5 — Brand Context Package. Runs after DNA extraction, before HTML
 * generation. Becomes the SOURCE OF TRUTH for generation: the real assets,
 * copy, voice, imagery and patterns of the source product — so a new page
 * feels designed AND written by the original company, not merely recolored.
 */

const Scale = z.enum(["very-low", "low", "medium", "high", "very-high"]);

export const AssetSchema = z.object({
  url: z.string(),
  type: z.string(),
  alt: z.string().default(""),
  width: z.number().default(0),
  height: z.number().default(0),
  role: z.string(),
  page: z.string().default(""),
});

export const CopyItemSchema = z.object({
  type: z.string(),
  content: z.string(),
  frequency: z.number().default(1),
});

/** Claude Vision over screenshots — how the brand presents itself visually. */
export const ScreenshotAnalysisSchema = z.object({
  visualStyle: z.string(),
  imageryStyle: z.string(),
  compositionStyle: z.string(),
  productPresentationStyle: z.string(),
  screenshotPurpose: z.string(),
  visualHierarchy: z.string(),
  decorativePatterns: z.string(),
  source: z.enum(["vision", "heuristic"]).default("heuristic"),
});

/** Brand voice fingerprint — how the brand writes. */
export const BrandVoiceSchema = z.object({
  tone: z.string(), // e.g. "concise, technical, minimal"
  readingLevel: z.string(), // e.g. "professional", "general"
  sentenceLength: z.enum(["short", "medium", "long"]).default("medium"),
  emotionalIntensity: Scale,
  technicalDepth: Scale,
  conversionStyle: z.string(), // e.g. "product-led", "low-pressure", "direct"
  trustSignals: z.array(z.string()).default([]),
  vocabulary: z.array(z.string()).default([]), // recurring brand words
  source: z.enum(["ai", "heuristic"]).default("heuristic"),
});

export const BrandContextSchema = z.object({
  assets: z.array(AssetSchema).default([]),
  screenshots: z.array(z.object({ key: z.string(), kind: z.string(), label: z.string().default("") })).default([]),
  /** Original CSS custom properties harvested from the source site. */
  cssVariables: z.record(z.string(), z.string()).default({}),
  /**
   * Compact raw variable library for prompt injection. This keeps the
   * generator grounded in the source site's real token names and values.
   */
  rawVariables: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  copyLibrary: z.array(CopyItemSchema).default([]),
  headlines: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  testimonials: z.array(z.string()).default([]),
  products: z.array(z.string()).default([]),
  imageryPatterns: z.array(z.string()).default([]),
  iconographyPatterns: z.array(z.string()).default([]),
  visualMotifs: z.array(z.string()).default([]),
  navigationPatterns: z.array(z.string()).default([]),
  ctaPatterns: z.array(z.string()).default([]),
  contentPatterns: z.array(z.string()).default([]),
  sectionPatterns: z.array(z.string()).default([]),
  screenshotAnalysis: ScreenshotAnalysisSchema,
  brandVoice: BrandVoiceSchema,
  // Generic phrases the generator must AVOID (copy rules).
  forbiddenPhrases: z.array(z.string()).default([]),
});

export type Asset = z.infer<typeof AssetSchema>;
export type CopyItem = z.infer<typeof CopyItemSchema>;
export type ScreenshotAnalysis = z.infer<typeof ScreenshotAnalysisSchema>;
export type BrandVoice = z.infer<typeof BrandVoiceSchema>;
export type BrandContext = z.infer<typeof BrandContextSchema>;

export const FORBIDDEN_GENERIC_PHRASES = [
  "build the future",
  "get started",
  "join thousands",
  "transform your business",
  "take it to the next level",
  "unlock your potential",
  "supercharge",
  "game-changer",
  "revolutionize",
  "empower your team",
];
