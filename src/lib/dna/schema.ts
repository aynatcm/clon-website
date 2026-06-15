import { z } from "zod";

/**
 * Phase 4 — Design DNA schema. This is the contract for `design-dna.json`, the
 * permanent source of truth. Every field is grounded in observed data or
 * Claude's synthesis over observed data; nothing is assumed by the schema.
 *
 * The same schema validates: (a) Claude's synthesis output, and (b) the JSON
 * blob stored in the DesignDna table.
 */

const Scale = z.enum(["very-low", "low", "medium", "high", "very-high"]);

export const DesignPhilosophySchema = z.object({
  // Each axis is a 0..1 position between the two named poles + a label.
  minimalToExpressive: z.number().min(0).max(1),
  massToPremium: z.number().min(0).max(1),
  corporateToStartup: z.number().min(0).max(1),
  formalToFriendly: z.number().min(0).max(1),
  denseToSpacious: z.number().min(0).max(1),
  traditionalToModern: z.number().min(0).max(1),
  // Short human-readable summary of the brand personality.
  summary: z.string(),
  keywords: z.array(z.string()).default([]),
});

export const ColorTokenSchema = z.object({
  name: z.string(), // token name e.g. "primary", "surface-2"
  value: z.string(), // hex
  role: z.string(), // primary | secondary | accent | surface | background | border | neutral | cta | hero
  usage: z.string().optional(),
});

/** Evidence Layer — a traceable color decision (problem 6). */
export const ColorDecisionSchema = z.object({
  value: z.string(),
  evidence: z.array(z.string()).default([]), // where it was observed
  confidence: z.number().min(0).max(1).default(0),
});

export const ColorDnaSchema = z.object({
  tokens: z.array(ColorTokenSchema),
  // Semantic decisions with evidence (importance-based, the brand-color fix).
  decisions: z
    .object({
      primary: ColorDecisionSchema.optional(),
      secondary: ColorDecisionSchema.optional(),
      accent: ColorDecisionSchema.optional(),
      cta: ColorDecisionSchema.optional(),
      ctaText: ColorDecisionSchema.optional(),
      background: ColorDecisionSchema.optional(),
      surface: ColorDecisionSchema.optional(),
      border: ColorDecisionSchema.optional(),
      text: ColorDecisionSchema.optional(),
    })
    .default({}),
  ignored: z.array(z.string()).default([]), // wp/gutenberg/neutral colors excluded
  primary: z.array(z.string()).default([]),
  secondary: z.array(z.string()).default([]),
  accent: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  backgrounds: z.array(z.string()).default([]),
  borders: z.array(z.string()).default([]),
  neutrals: z.array(z.string()).default([]),
  dominant: z.array(z.string()).default([]),
  cta: z.array(z.string()).default([]),
  hero: z.array(z.string()).default([]),
  mode: z.enum(["light", "dark", "mixed"]).default("light"),
});

export const TypeStyleSchema = z.object({
  role: z.string(), // display | h1 | h2 | h3 | body | small | button | mono | eyebrow
  fontFamily: z.string(),
  fontSize: z.string(),
  fontWeight: z.string(),
  lineHeight: z.string().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.string().optional(),
});

export const TypographyDnaSchema = z.object({
  fonts: z.array(
    z.object({
      family: z.string(),
      role: z.string(), // heading | body | mono
      weights: z.array(z.string()).default([]),
      fallback: z.string().optional(),
      source: z.string().optional(), // google | system | custom
    }),
  ),
  scale: z.array(TypeStyleSchema),
  baseSize: z.string().default("16px"),
  scaleRatio: z.number().optional(),
  paragraphMaxWidth: z.string().optional(),
  defaultAlignment: z.enum(["left", "center", "right", "justify"]).default("left"),
});

export const SpacingDnaSchema = z.object({
  unit: z.number().default(4), // base spacing unit in px
  scale: z.array(z.string()), // ordered spacing tokens e.g. ["4px","8px",...]
  sectionSpacing: z.array(z.string()).default([]), // vertical rhythm between sections
  density: Scale.default("medium"),
  gap: z.array(z.string()).default([]),
});

export const LayoutDnaSchema = z.object({
  containers: z.array(z.string()), // max-width values
  maxContentWidth: z.string().optional(),
  gridSystems: z.array(z.string()).default([]), // representative grid-template-columns
  columns: z.number().default(12),
  responsive: z.object({
    breakpoints: z.array(z.string()).default([]),
    mobileColumns: z.number().default(1),
    tabletColumns: z.number().default(2),
    notes: z.string().optional(),
  }),
});

/** A measured component variant fingerprint (problem 3). */
export const ComponentVariantSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  usageCount: z.number().default(0),
  radius: z.string().optional(),
  height: z.string().optional(),
  fontWeight: z.string().optional(),
  fontSize: z.string().optional(),
  padding: z.string().optional(),
  background: z.string().optional(),
  color: z.string().optional(),
  border: z.string().optional(),
  shadow: z.string().optional(),
});

export const ComponentDnaSchema = z.object({
  type: z.string(), // button | nav | form | card | input | badge | ...
  variants: z.array(ComponentVariantSchema).default([]),
  structure: z.string(), // prose description of internal structure/hierarchy
  radius: z.string().optional(),
  shadow: z.string().optional(),
  border: z.string().optional(),
  background: z.string().optional(),
  typography: z.string().optional(),
  spacing: z.string().optional(),
  hierarchy: z.string().optional(),
});

/** Structural fingerprint stored alongside a section type (problem 2). */
export const SectionFingerprintSchema = z
  .object({
    columns: z.number().optional(),
    headingCount: z.number().optional(),
    paragraphCount: z.number().optional(),
    imageCount: z.number().optional(),
    buttonCount: z.number().optional(),
    listItemCount: z.number().optional(),
    hasForm: z.boolean().optional(),
    hasTable: z.boolean().optional(),
    hasCurrency: z.boolean().optional(),
    hasBigNumbers: z.boolean().optional(),
    hasCheckmarks: z.boolean().optional(),
  })
  .optional();

export const SectionDnaSchema = z.object({
  // Advanced taxonomy: hero | split-hero | feature-grid | service-grid |
  // process-section | timeline | team-section | faq | pricing | stats |
  // logo-cloud | cta | footer-cta | testimonials | portfolio | case-studies |
  // content-block | feature-comparison | trust-section | contact-section | nav | footer
  type: z.string(),
  frequency: z.number().default(1),
  structure: z.string(),
  layout: z.string().optional(),
  contentSlots: z.array(z.string()).default([]),
  fingerprint: SectionFingerprintSchema,
  evidence: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const VisualRulesSchema = z.object({
  whitespace: Scale,
  visualRhythm: z.string(),
  hierarchy: z.string(),
  contentDensity: Scale,
  alignment: z.string(),
  composition: z.string(),
  imagery: z.string(), // image placement / treatment
  decorativeElements: z.string(), // gradients, blobs, lines, noise...
  motion: z.string(), // observed/implied motion patterns
  cornerStyle: z.enum(["sharp", "subtle", "rounded", "pill", "mixed"]).default("subtle"),
  shadowStyle: z.enum(["none", "subtle", "medium", "strong", "mixed"]).default("subtle"),
  borderStyle: z.string().optional(),
});

/** Brand Personality (problem 5) — derived primarily from VISUAL analysis. */
export const BrandPersonalitySchema = z.object({
  industry: z.string(),
  visualStyle: z.string(),
  trustLevel: Scale,
  premiumLevel: Scale,
  energy: Scale,
  playfulness: Scale,
  density: Scale,
  conversionFocus: Scale,
});

/** Visual Brand Analysis (problem 4) — screenshot-first, outranks CSS. */
export const VisualBrandAnalysisSchema = z.object({
  visualHierarchy: z.string(),
  layoutDensity: Scale,
  whitespaceUsage: Scale,
  visualRhythm: z.string(),
  alignmentStyle: z.string(),
  ctaProminence: Scale,
  brandPersonality: BrandPersonalitySchema,
  premiumLevel: Scale,
  playfulness: Scale,
  trustLevel: Scale,
  corporateVsStartup: z.number().min(0).max(1), // 0 corporate .. 1 startup
  minimalVsExpressive: z.number().min(0).max(1), // 0 minimal .. 1 expressive
  source: z.enum(["vision", "heuristic"]).default("heuristic"),
  notes: z.string().optional(),
});

/** Confidence Report (problem 8) — explains grounded vs inferred decisions. */
export const ConfidenceReportSchema = z.object({
  groundedData: z.array(z.string()).default([]),
  inferredData: z.array(z.string()).default([]),
  visualConfidence: z.number().min(0).max(1).default(0),
  structuralConfidence: z.number().min(0).max(1).default(0),
  overallConfidence: z.number().min(0).max(1).default(0),
  explanations: z.array(z.string()).default([]),
});

export const DesignDnaSchema = z.object({
  designPhilosophy: DesignPhilosophySchema,
  brandPersonality: BrandPersonalitySchema,
  visualAnalysis: VisualBrandAnalysisSchema,
  colors: ColorDnaSchema,
  typography: TypographyDnaSchema,
  spacing: SpacingDnaSchema,
  layout: LayoutDnaSchema,
  components: z.array(ComponentDnaSchema),
  sections: z.array(SectionDnaSchema),
  visualRules: VisualRulesSchema,
  confidenceReport: ConfidenceReportSchema,
  // References to stored screenshots used as visual evidence.
  screenshots: z
    .array(
      z.object({
        key: z.string(),
        kind: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  // Provenance: which sources fed the DNA + a 0..1 confidence.
  provenance: z
    .object({
      sources: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1).default(0),
      notes: z.string().optional(),
    })
    .default({ sources: [], confidence: 0 }),
});

export type DesignPhilosophy = z.infer<typeof DesignPhilosophySchema>;
export type ColorDna = z.infer<typeof ColorDnaSchema>;
export type TypographyDna = z.infer<typeof TypographyDnaSchema>;
export type SpacingDna = z.infer<typeof SpacingDnaSchema>;
export type LayoutDna = z.infer<typeof LayoutDnaSchema>;
export type ComponentDna = z.infer<typeof ComponentDnaSchema>;
export type SectionDna = z.infer<typeof SectionDnaSchema>;
export type VisualRules = z.infer<typeof VisualRulesSchema>;
export type ColorDecision = z.infer<typeof ColorDecisionSchema>;
export type ComponentVariant = z.infer<typeof ComponentVariantSchema>;
export type BrandPersonality = z.infer<typeof BrandPersonalitySchema>;
export type VisualBrandAnalysis = z.infer<typeof VisualBrandAnalysisSchema>;
export type ConfidenceReport = z.infer<typeof ConfidenceReportSchema>;
export type DesignDna = z.infer<typeof DesignDnaSchema>;
