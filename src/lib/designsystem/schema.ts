import { z } from "zod";

/**
 * Phase 6 — Design System: the actionable layer derived from the Design DNA.
 * Tokens + component/layout libraries + machine-usable rules. Plus a
 * self-contained CSS string injected into every generated page for continuity.
 *
 * Layouts and components carry the MEASURED fingerprints so the generator is
 * layout-driven (instantiates detected patterns) instead of section-driven.
 */

/** Applied component fingerprint — geometry the generator must inherit. */
export const ComponentFingerprintSchema = z.object({
  radius: z.string().optional(),
  padding: z.string().optional(),
  height: z.string().optional(),
  fontWeight: z.string().optional(),
  fontSize: z.string().optional(),
  background: z.string().optional(),
  color: z.string().optional(),
  border: z.string().optional(),
  shadow: z.string().optional(),
  usageCount: z.number().default(0),
});

export const DesignSystemSchema = z.object({
  tokens: z.object({
    colors: z.record(z.string(), z.string()),
    fonts: z.record(z.string(), z.string()),
    fontSizes: z.record(z.string(), z.string()),
    fontWeights: z.record(z.string(), z.string()),
    spacing: z.record(z.string(), z.string()),
    radii: z.record(z.string(), z.string()),
    shadows: z.record(z.string(), z.string()),
    containers: z.record(z.string(), z.string()),
  }),
  components: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      className: z.string(), // canonical class used in generated HTML
      description: z.string(),
      rules: z.array(z.string()).default([]),
      fingerprint: ComponentFingerprintSchema.optional(),
      variants: z.array(ComponentFingerprintSchema).default([]),
    }),
  ),
  layouts: z.array(
    z.object({
      name: z.string(),
      type: z.string(), // detected section type (the source of truth)
      structure: z.string(),
      contentSlots: z.array(z.string()).default([]),
      // Structural fingerprint — preserved by the renderer.
      variant: z.enum(["split", "grid", "stacked", "centered", "form", "logos", "media"]).default("stacked"),
      columns: z.number().default(1),
      hasMedia: z.boolean().default(false),
      hasForm: z.boolean().default(false),
      itemCount: z.number().default(0),
      frequency: z.number().default(1),
    }),
  ),
  rules: z.object({
    design: z.array(z.string()),
    visual: z.array(z.string()),
    spacing: z.array(z.string()),
    typography: z.array(z.string()),
    component: z.array(z.string()),
    layout: z.array(z.string()),
  }),
});

export type DesignSystem = z.infer<typeof DesignSystemSchema>;
export type ComponentFingerprint = z.infer<typeof ComponentFingerprintSchema>;
