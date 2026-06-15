import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { PageArchitecture, SimilarityReport } from "./schema";
import { SimilarityReportSchema } from "./schema";
import { env } from "@/lib/env";
import type { VisualBreakdown } from "./visualSimilarity";

/**
 * Phase 10 layer 1 — DNA adherence. Verifies the generated HTML uses the
 * Design System tokens (fonts, colors, containers, components, sections,
 * spacing, corners/shadows). This is necessary but not sufficient, so it is
 * combined with the rendered visualSimilarity layer (layer 2).
 */

const pct = (num: number, den: number) => (den <= 0 ? 100 : Math.round((num / den) * 100));
const clamp = (n: number) => Math.max(0, Math.min(100, n));

function countPresent(haystack: string, needles: string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const x of needles) if (x && h.includes(x.toLowerCase())) n++;
  return n;
}

export interface DnaAdherence {
  typography: number;
  layout: number;
  component: number;
  section: number;
  visual: number;
  brand: number;
  spacing: number;
  structuralAdherence: number; // do sections use the expected layout structures?
  dnaSimilarity: number;
  issues: string[];
}

/** Does the HTML contain the structural class each section's variant requires? */
function scoreStructuralAdherence(html: string, arch: PageArchitecture): { score: number; issues: string[] } {
  const issues: string[] = [];
  let matched = 0;
  for (const s of arch.sections) {
    const variant = s.layout ?? "stacked";
    let ok = true;
    if (variant === "split") ok = /dna-split/.test(html) && /dna-media/.test(html);
    else if (variant === "grid") ok = /dna-grid--[2-6]/.test(html) || /dna-grid\b/.test(html);
    else if (variant === "form") ok = /<form|dna-input/.test(html);
    else if (variant === "logos") ok = /dna-logos/.test(html);
    else ok = /<section|<footer|<header/.test(html); // centered/stacked: section present
    if (ok) matched++;
    else issues.push(`layout: "${s.type}" (${variant}) structure not instantiated`);
  }
  return { score: arch.sections.length ? Math.round((matched / arch.sections.length) * 100) : 100, issues };
}

export function scoreDnaAdherence(
  html: string,
  arch: PageArchitecture,
  dna: DesignDna,
  system: DesignSystem,
): DnaAdherence {
  const issues: string[] = [];
  const hasRoot = /:root\s*\{/.test(html);

  const fontFamilies = dna.typography.fonts.map((f) => f.family);
  const fontHit = countPresent(html, fontFamilies);
  const typography = clamp(pct(fontHit, fontFamilies.length));
  if (typography < 100) issues.push(`typography: ${fontHit}/${fontFamilies.length} brand fonts referenced`);

  const keyColors = Array.from(
    new Set([...dna.colors.primary, ...dna.colors.cta, ...dna.colors.accent, ...dna.colors.dominant.slice(0, 3)]),
  ).filter(Boolean);
  const colorHit = countPresent(html, keyColors);
  const color = clamp(Math.max(pct(colorHit, Math.max(1, Math.min(keyColors.length, 6))), hasRoot ? 70 : 0));
  if (colorHit === 0 && keyColors.length) issues.push("color: no brand colors found in output");

  const maxW = system.tokens.containers["max"];
  const containerOk = (maxW && html.includes(maxW)) || /dna-container/.test(html);
  const gridOk = /dna-grid|display:\s*grid|grid-template/.test(html);
  const layout = clamp((containerOk ? 60 : 0) + (gridOk ? 40 : 0));
  if (!containerOk) issues.push("layout: container max-width not applied");

  const compClasses = system.components.map((c) => c.className);
  const compHit = compClasses.length ? countPresent(html, compClasses) : 0;
  const usesButton = /dna-button|dna-cta/.test(html);
  const component = clamp(Math.max(pct(compHit, Math.max(1, compClasses.length)), usesButton ? 65 : 0));

  const wanted = arch.sections.length;
  const rendered = (html.match(/<section|<footer|<header/g) ?? []).length;
  const section = clamp(pct(Math.min(rendered, wanted), Math.max(1, wanted)));
  if (rendered < wanted) issues.push(`section: ${rendered}/${wanted} sections rendered`);

  const radiusOk = /--radius-base|border-radius/.test(html);
  const shadowOk = dna.visualRules.shadowStyle === "none" ? true : /box-shadow|--shadow-/.test(html);
  const visual = clamp((radiusOk ? 50 : 0) + (shadowOk ? 50 : 0));

  const spacingOk = /--space-|clamp\(|dna-section/.test(html);
  const spacing = clamp(spacingOk ? 90 : 40);
  if (!spacingOk) issues.push("spacing: no system spacing rhythm detected");

  const brand = clamp(hasRoot ? Math.round((typography + color + visual) / 3) : 40);

  const struct = scoreStructuralAdherence(html, arch);
  issues.push(...struct.issues);

  const w = { typography: 0.16, layout: 0.16, component: 0.16, section: 0.14, visual: 0.14, brand: 0.12, spacing: 0.12 };
  const dnaSimilarity = clamp(
    Math.round(
      typography * w.typography +
        layout * w.layout +
        component * w.component +
        section * w.section +
        visual * w.visual +
        brand * w.brand +
        spacing * w.spacing,
    ),
  );

  return { typography, layout, component, section, visual, brand, spacing, structuralAdherence: struct.score, dnaSimilarity, issues };
}

/**
 * Combine the two layers into the final report. When visual layer is skipped
 * (render failed), fall back to DNA-only but flag it so scores aren't trusted
 * as visual confirmation.
 */
/**
 * Final score with requirement-9 weights:
 *   layout 40% · visual 30% · typography 15% · spacing 15%.
 * Layout dominates, so a layout mismatch is penalized heavily. Each bucket
 * blends the rendered re-extraction (preferred) with DNA-string adherence.
 */
export function combineSimilarity(
  dnaPart: DnaAdherence,
  visual: { score: number; breakdown: VisualBreakdown; issues: string[] } | null,
): SimilarityReport {
  const visualUsed = !!visual && visual.breakdown.method === "rendered";
  const b = visual?.breakdown;

  // LAYOUT (40%): rendered structural fidelity + string structural adherence.
  // Hard gate: layout may NOT exceed 90 unless every required structural element
  // is present in the rendered page (b.structuralComplete).
  let layout = visualUsed
    ? clamp(Math.round(b!.layout * 0.55 + dnaPart.structuralAdherence * 0.45))
    : clamp(Math.round(dnaPart.structuralAdherence * 0.6 + dnaPart.layout * 0.4));
  if (!visualUsed || !b?.structuralComplete) layout = Math.min(layout, 90);

  // VISUAL (30%): rendered color + corners (falls back to string proxies).
  const visualBucket = visualUsed
    ? clamp(Math.round(b!.color * 0.6 + b!.corners * 0.4))
    : clamp(dnaPart.visual);

  // TYPOGRAPHY (15%): rendered fonts preferred.
  const typography = visualUsed ? clamp(Math.max(b!.typography, Math.round(dnaPart.typography * 0.7))) : clamp(dnaPart.typography);

  // SPACING (15%): system rhythm adherence.
  const spacing = clamp(dnaPart.spacing);

  const weighted = layout * 0.4 + visualBucket * 0.3 + typography * 0.15 + spacing * 0.15;
  const overallSimilarity = visualUsed
    ? clamp(Math.round(weighted))
    : clamp(Math.min(80, Math.round(weighted))); // DNA-only cannot fully confirm

  // For display: the rendered composite similarity.
  const visualSimilarity = visualUsed ? clamp(visual!.score) : 0;

  const issues = [...dnaPart.issues, ...(visual?.issues ?? [])];
  if (!visualUsed) issues.push("visual: rendered comparison unavailable — score capped (DNA-only)");

  return SimilarityReportSchema.parse({
    typography,
    layout,
    component: dnaPart.component,
    section: dnaPart.section,
    visual: visualBucket,
    brand: dnaPart.brand,
    spacing,
    dnaSimilarity: dnaPart.dnaSimilarity,
    visualSimilarity,
    overallSimilarity,
    overall: overallSimilarity,
    visualBreakdown: visual?.breakdown,
    passed: overallSimilarity >= env.SIMILARITY_THRESHOLD,
    issues,
  });
}
