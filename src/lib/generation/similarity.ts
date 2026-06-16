import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
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
  const expected = {
    split: arch.sections.filter((s) => s.layout === "split").length,
    media: arch.sections.filter((s) => s.layout === "media").length,
    grid: arch.sections.filter((s) => s.layout === "grid").length,
    form: arch.sections.filter((s) => s.layout === "form").length,
    logos: arch.sections.filter((s) => s.layout === "logos").length,
  };
  const actual = {
    split: (html.match(/class="[^"]*\bdna-split\b/g) ?? []).length,
    media: (html.match(/class="[^"]*\bdna-media\b/g) ?? []).filter((m) => !/data-generated-mock/.test(m)).length,
    grid: (html.match(/class="[^"]*\bdna-grid\b/g) ?? []).length,
    form: (html.match(/<form\b/g) ?? []).length,
    logos: (html.match(/class="[^"]*\bdna-logos\b/g) ?? []).length,
  };
  let need = 0;
  let got = 0;
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    need += expected[key];
    got += Math.min(expected[key], actual[key]);
    if (actual[key] < expected[key]) issues.push(`layout: expected ${expected[key]} ${key} section(s), rendered ${actual[key]}`);
  }
  return { score: need ? Math.round((got / need) * 100) : 100, issues };
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
export interface BrandAdherence {
  voice: number;
  content: number;
  assetUsage: number;
  visualLanguage: number;
  brandSimilarity: number;
  issues: string[];
}

/**
 * Brand Similarity — evaluates voice, content style, asset usage and visual
 * language reuse against the Brand Context. Penalizes forbidden generic copy
 * and empty/placeholder media; rewards reuse of real assets + brand vocabulary.
 */
export function scoreBrandAdherence(
  html: string,
  brand: BrandContext | undefined,
  arch: PageArchitecture,
  dna: DesignDna,
): BrandAdherence {
  const issues: string[] = [];
  const lower = html.toLowerCase();
  const htmlNoStyle = html.replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = lower.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

  // VOICE: no forbidden generic phrases + brand vocabulary present.
  const forbidden = (brand?.forbiddenPhrases ?? []).filter((p) => text.includes(p.toLowerCase()));
  const brokenCopy = [
    /\bcomm and\b/i,
    /\bau to\b/i,
    /\bunderst and\b/i,
    /\bnavigatefrom\b/i,
    /\bproductoperations\b/i,
    /\bproductdevelopment\b/i,
    /\bbuild the future\b/i,
    /\bjoin thousands\b/i,
    /\btransform your business\b/i,
  ].filter((re) => re.test(text));
  let voice = 100 - forbidden.length * 20 - brokenCopy.length * 25;
  if (forbidden.length) issues.push(`brand: generic phrases used — ${forbidden.join(", ")}`);
  if (brokenCopy.length) issues.push(`brand: broken or generic copy fragments detected (${brokenCopy.length})`);
  const vocab = brand?.brandVoice.vocabulary ?? [];
  if (vocab.length) {
    const hits = vocab.filter((w) => text.includes(w.toLowerCase())).length;
    voice = clamp(Math.round(voice * 0.6 + (hits / vocab.length) * 100 * 0.4));
  } else voice = clamp(voice);

  // CONTENT: reuse of real headlines / feature names / CTA labels.
  const corpus = [...(brand?.headlines ?? []), ...(brand?.features ?? []), ...(brand?.navigationPatterns ?? [])]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 3);
  let content = 60;
  if (corpus.length) {
    const reused = corpus.filter((c) => text.includes(c)).length;
    const exactScore = Math.min(1, reused / Math.min(corpus.length, 8)) * 100;
    const ctaCorpus = (brand?.ctaPatterns ?? []).map((s) => s.toLowerCase()).filter((s) => s.length > 3 && !s.endsWith("-cta"));
    const ctaHits = ctaCorpus.filter((c) => text.includes(c)).length;
    const ctaScore = ctaCorpus.length ? Math.min(1, ctaHits / Math.min(ctaCorpus.length, 4)) * 100 : exactScore;
    const vocabHits = vocab.filter((w) => text.includes(w.toLowerCase())).length;
    const vocabScore = vocab.length ? Math.min(1, vocabHits / Math.min(vocab.length, 8)) * 100 : exactScore;
    content = clamp(Math.round(exactScore * 0.55 + ctaScore * 0.2 + vocabScore * 0.25));
    if (reused === 0 && ctaHits === 0) issues.push("brand: no real brand copy reused");
  }

  // ASSET USAGE: media sections should use real assets (or filled mocks).
  const mediaNeeded = arch.sections.filter((s) => s.layout === "split" || s.layout === "media" || s.layout === "logos").length;
  const realImgs = (htmlNoStyle.match(/dna-media__img|dna-logos__item[^>]*>\s*<img/g) ?? []).length;
  const mockFills = (htmlNoStyle.match(/data-generated-mock="true"|dna-mock\b/g) ?? []).length;
  const emptyMedia = (htmlNoStyle.match(/class="dna-media"[^>]*>\s*<\/div>/g) ?? []).length;
  const usableRealAssets = (brand?.assets ?? []).filter((a) => /^(https?:\/\/|data:image\/|\/)/.test(a.url) && /dashboard|product-shot|hero-image|illustration|feature-image|logo/.test(a.role)).length;
  let assetUsage = mediaNeeded === 0 ? 80 : clamp(Math.round((Math.min(mediaNeeded, realImgs * 2 + (usableRealAssets ? 0 : mockFills)) / mediaNeeded) * 100));
  const hasRealAsset = /dna-media__img|<img[^>]+(?:https?:|data:image|\/)/.test(htmlNoStyle);
  if (hasRealAsset) assetUsage = Math.max(assetUsage, 85);
  if (usableRealAssets > 0 && mockFills > 0) {
    assetUsage = Math.min(assetUsage, 55);
    issues.push("brand: generated mock media used despite real brand assets being available");
  }
  if (emptyMedia > 0) {
    assetUsage = Math.min(assetUsage, 40);
    issues.push(`brand: ${emptyMedia} empty media area(s)`);
  }

  // VISUAL LANGUAGE: motif reuse (corners + shadow + decoration cues).
  let visualLanguage = 60;
  if (dna.visualRules.cornerStyle === "pill" && /9999px|border-radius:\s*999/.test(html)) visualLanguage += 20;
  if (dna.visualRules.shadowStyle !== "none" && /box-shadow|--shadow-/.test(html)) visualLanguage += 10;
  if (/--color-(primary|cta|accent)/.test(html)) visualLanguage += 10;
  visualLanguage = clamp(visualLanguage);

  const brandSimilarity = clamp(Math.round(voice * 0.3 + content * 0.3 + assetUsage * 0.25 + visualLanguage * 0.15));
  return { voice: clamp(voice), content, assetUsage, visualLanguage, brandSimilarity, issues };
}

/**
 * Final score (Brand Extension weights):
 *   layout 30% · visual 25% · brand 25% · typography 10% · spacing 10%.
 * Each bucket blends rendered re-extraction (preferred) with string adherence.
 */
export function combineSimilarity(
  dnaPart: DnaAdherence,
  visual: { score: number; breakdown: VisualBreakdown; issues: string[] } | null,
  brandPart?: BrandAdherence,
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

  // TYPOGRAPHY (10%): rendered fonts preferred.
  const typography = visualUsed ? clamp(Math.max(b!.typography, Math.round(dnaPart.typography * 0.7))) : clamp(dnaPart.typography);

  // SPACING (10%): system rhythm adherence.
  const spacing = clamp(dnaPart.spacing);

  // BRAND (25%): voice + content + asset usage + visual language.
  const brandSimilarity = brandPart ? clamp(brandPart.brandSimilarity) : clamp(Math.round(dnaPart.brand * 0.7));

  // Brand Extension weights: layout 30 · visual 25 · brand 25 · typo 10 · spacing 10.
  const weighted = layout * 0.3 + visualBucket * 0.25 + brandSimilarity * 0.25 + typography * 0.1 + spacing * 0.1;
  const overallSimilarity = visualUsed
    ? clamp(Math.round(weighted))
    : clamp(Math.min(80, Math.round(weighted))); // DNA-only cannot fully confirm

  // For display: the rendered composite similarity.
  const visualSimilarity = visualUsed ? clamp(visual!.score) : 0;

  const issues = [...dnaPart.issues, ...(visual?.issues ?? []), ...(brandPart?.issues ?? [])];
  if (!visualUsed) issues.push("visual: rendered comparison unavailable — score capped (DNA-only)");
  const structuralComplete = !!visual?.breakdown?.structuralComplete;
  const passGate =
    overallSimilarity >= env.SIMILARITY_THRESHOLD &&
    visualSimilarity >= 75 &&
    layout >= 80 &&
    brandSimilarity >= 75 &&
    (!brandPart || brandPart.assetUsage >= 75) &&
    spacing >= 70 &&
    structuralComplete;
  if (!passGate) issues.push("quality gate: layout, visual, brand, spacing, and structural completeness must all pass");

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
    brandSimilarity,
    overallSimilarity,
    overall: overallSimilarity,
    visualBreakdown: visual?.breakdown,
    brandBreakdown: brandPart
      ? { voice: brandPart.voice, content: brandPart.content, assetUsage: brandPart.assetUsage, visualLanguage: brandPart.visualLanguage }
      : undefined,
    passed: passGate,
    issues,
  });
}
