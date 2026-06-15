import type { Evidence } from "@/lib/extraction/evidence";
import { structured, type ImageInput, aiFeatures } from "@/lib/ai/claude";
import { getObjectBuffer } from "@/lib/storage/r2";
import { VisualBrandAnalysisSchema, type VisualBrandAnalysis } from "./schema";

/**
 * Phase 4.5 — Visual Brand Analysis. Runs BEFORE DNA synthesis and its output
 * OUTRANKS CSS evidence (problem 4: "if CSS and screenshots disagree, trust
 * screenshots"). Uses Claude Vision; falls back to evidence-based heuristics.
 */

async function loadImages(ev: Evidence, max = 6): Promise<ImageInput[]> {
  const priority = ["DESKTOP", "HERO", "MOBILE", "NAVIGATION", "SECTION", "FOOTER", "TABLET"];
  const picked: typeof ev.screenshots = [];
  for (const kind of priority) {
    const s = ev.screenshots.find((x) => x.kind === kind && !picked.includes(x));
    if (s) picked.push(s);
    if (picked.length >= max) break;
  }
  for (const s of ev.screenshots) {
    if (picked.length >= max) break;
    if (!picked.includes(s)) picked.push(s);
  }
  const out: ImageInput[] = [];
  for (const s of picked) {
    try {
      const buf = await getObjectBuffer(s.key);
      if (buf.length > 4_500_000) continue;
      out.push({ base64: buf.toString("base64"), mediaType: "image/png" });
    } catch {
      /* skip */
    }
  }
  return out;
}

type Scale = "very-low" | "low" | "medium" | "high" | "very-high";
const scaleFrom = (n: number): Scale =>
  n < 0.2 ? "very-low" : n < 0.4 ? "low" : n < 0.6 ? "medium" : n < 0.8 ? "high" : "very-high";

/** Heuristic fallback derived from structural evidence (no screenshots read). */
export function heuristicVisualAnalysis(ev: Evidence): VisualBrandAnalysis {
  const padTop = ev.sectionPaddings
    .map((p) => parseFloat(p.split("/")[0]))
    .filter((n) => !isNaN(n));
  const avgPad = padTop.length ? padTop.reduce((a, b) => a + b, 0) / padTop.length : 48;
  const spacious = Math.min(1, avgPad / 120);
  const density = scaleFrom(1 - spacious);
  const sat = ev.colorRoles.primary ? 0.6 : 0.3;
  const sectionVariety = new Set(ev.sections.map((s) => s.type)).size;
  const ctaVariants = ev.components.find((c) => c.type === "button")?.variants.length ?? 0;
  const expressive = Math.min(1, (sat + sectionVariety / 16) / 1.4);

  return VisualBrandAnalysisSchema.parse({
    visualHierarchy: "Large headings over supporting text; CTAs visually separated.",
    layoutDensity: density,
    whitespaceUsage: scaleFrom(spacious),
    visualRhythm: "Consistent vertical spacing between sections.",
    alignmentStyle: "Centered max-width container; left-aligned text blocks.",
    ctaProminence: scaleFrom(Math.min(1, 0.4 + ctaVariants * 0.1)),
    brandPersonality: {
      industry: "unknown",
      visualStyle: expressive > 0.5 ? "expressive" : "minimal",
      trustLevel: "medium",
      premiumLevel: spacious > 0.6 ? "high" : "medium",
      energy: scaleFrom(expressive),
      playfulness: scaleFrom(Math.max(0, expressive - 0.2)),
      density,
      conversionFocus: scaleFrom(Math.min(1, 0.4 + ctaVariants * 0.1)),
    },
    premiumLevel: spacious > 0.6 ? "high" : "medium",
    playfulness: scaleFrom(Math.max(0, expressive - 0.2)),
    trustLevel: "medium",
    corporateVsStartup: 0.5,
    minimalVsExpressive: expressive,
    source: "heuristic",
    notes: "Derived from structural evidence (no vision model).",
  });
}

const SYSTEM = `You are a brand and visual design analyst. You judge a website's identity from SCREENSHOTS, not code.
Look at composition, hierarchy, whitespace, color emphasis, typography feel, and CTA prominence.
Be decisive and specific. Output ONLY JSON matching the schema.`;

export async function analyzeVisualBrand(ev: Evidence): Promise<VisualBrandAnalysis> {
  if (!aiFeatures.ai) return heuristicVisualAnalysis(ev);
  const images = await loadImages(ev);
  if (!images.length) return heuristicVisualAnalysis(ev);

  const prompt = `Analyze the brand identity of this website from the screenshots (desktop, mobile, sections).

Judge from what you SEE:
- visualHierarchy, layoutDensity, whitespaceUsage, visualRhythm, alignmentStyle, ctaProminence
- brandPersonality { industry, visualStyle, trustLevel, premiumLevel, energy, playfulness, density, conversionFocus }
- premiumLevel, playfulness, trustLevel
- corporateVsStartup (0=corporate, 1=startup), minimalVsExpressive (0=minimal, 1=expressive)

Scale fields use one of: very-low, low, medium, high, very-high.
Set source to "vision". Return the full JSON.`;

  try {
    const result = await structured(VisualBrandAnalysisSchema, prompt, {
      system: SYSTEM,
      images,
      maxTokens: 3000,
      temperature: 0.2,
    });
    return { ...result, source: "vision" };
  } catch {
    return heuristicVisualAnalysis(ev);
  }
}
