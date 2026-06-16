import { z } from "zod";

/** Phase 8 — page generation request. */
export const GenerationRequestSchema = z.object({
  pageType: z.string(), // about | pricing | landing | careers | contact | custom
  // Requested sections (ordered). Empty => architect picks from DNA sections.
  sections: z.array(z.string()).default([]),
  brief: z.string().default(""), // free-text requirements / content guidance
  title: z.string().optional(),
  audience: z.string().optional(),
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

/** Phase 9 — page architecture, grounded in DNA sections/components. */
export const PageArchitectureSchema = z.object({
  pageTitle: z.string(),
  metaDescription: z.string(),
  sections: z.array(
    z.object({
      type: z.string(), // maps to a DNA section type (closest match if novel)
      sourcePattern: z.string(), // which DNA section/component it extends
      heading: z.string().optional(),
      subheading: z.string().optional(),
      contentSlots: z.record(z.string(), z.string()).default({}),
      layout: z.string().optional(), // grid-3 | split | stacked | centered
      // Brand Extension fields (Phase 6.5 → architecture).
      visualAsset: z.string().optional(), // asset role to place, e.g. "dashboard-shot"
      visualAssetUrl: z.string().optional(), // resolved real asset URL when available
      copyPattern: z.string().optional(), // e.g. "product-led"
      componentPattern: z.string().optional(), // e.g. "pill-cta"
      sectionPattern: z.string().optional(), // detected section pattern it extends
      notes: z.string().optional(),
    }),
  ),
  rationale: z.string(), // why this structure belongs to the product
});
export type PageArchitecture = z.infer<typeof PageArchitectureSchema>;

/**
 * Phase 10 — two-layer similarity (problem 7).
 *  - dnaSimilarity: does the generated HTML adhere to the Design System tokens?
 *  - visualSimilarity: does the RENDERED page actually look like the DNA?
 *    (rendered + re-extracted, NOT the HTML-string vs DNA — avoids inflation)
 * overall considers both. HTML generation forbidden below threshold.
 */
export const SimilarityReportSchema = z.object({
  // DNA-adherence sub-scores
  typography: z.number().min(0).max(100),
  layout: z.number().min(0).max(100),
  component: z.number().min(0).max(100),
  section: z.number().min(0).max(100),
  visual: z.number().min(0).max(100),
  brand: z.number().min(0).max(100),
  spacing: z.number().min(0).max(100),
  // Layer scores
  dnaSimilarity: z.number().min(0).max(100),
  visualSimilarity: z.number().min(0).max(100),
  brandSimilarity: z.number().min(0).max(100).default(0),
  overallSimilarity: z.number().min(0).max(100),
  // back-compat alias of overallSimilarity
  overall: z.number().min(0).max(100),
  visualBreakdown: z
    .object({
      color: z.number().min(0).max(100),
      typography: z.number().min(0).max(100),
      layout: z.number().min(0).max(100),
      corners: z.number().min(0).max(100),
      sections: z.number().min(0).max(100),
      structuralComplete: z.boolean().default(false),
      missing: z.array(z.string()).default([]),
      method: z.enum(["rendered", "skipped"]),
    })
    .optional(),
  brandBreakdown: z
    .object({
      voice: z.number().min(0).max(100),
      content: z.number().min(0).max(100),
      assetUsage: z.number().min(0).max(100),
      visualLanguage: z.number().min(0).max(100),
    })
    .optional(),
  passed: z.boolean(),
  issues: z.array(z.string()).default([]),
});
export type SimilarityReport = z.infer<typeof SimilarityReportSchema>;
