import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { env } from "@/lib/env";
import { architectPage } from "./architect";
import { generateHtml } from "./html";
import { generateRecipePage } from "./recipeGen";
import { scoreDnaAdherence, scoreBrandAdherence, combineSimilarity } from "./similarity";
import { visualSimilarity } from "./visualSimilarity";
import { visualRepair } from "./repair";
import {
  GenerationRequestSchema,
  type GenerationRequest,
  type PageArchitecture,
  type SimilarityReport,
} from "./schema";

export * from "./schema";

export interface GenerationResult {
  architecture: PageArchitecture;
  html: string;
  similarity: SimilarityReport;
  iterations: number;
  repairRounds: number;
}

/**
 * Phase 7.5 orchestration. When Section Recipes exist, generation is RECIPE
 * INSTANTIATION (AI fills content slots only). The page then enters a closed-
 * loop visual repair (screenshot ↔ vision → CSS patch) until similarity > 90.
 * Falls back to the layout-driven architect path when no recipes are present.
 */
export async function generatePage(
  rawRequest: unknown,
  dna: DesignDna,
  system: DesignSystem,
  css: string,
  opts: { maxIterations?: number; log?: (m: string) => void; brand?: BrandContext } = {},
): Promise<GenerationResult> {
  const log = opts.log ?? (() => {});
  const brand = opts.brand;
  const request: GenerationRequest = GenerationRequestSchema.parse(rawRequest);

  // Recompute the full similarity report for a candidate (structure fixed).
  const scoreHtml = async (html: string, architecture: PageArchitecture): Promise<SimilarityReport> => {
    const dnaPart = scoreDnaAdherence(html, architecture, dna, system);
    const visual = await visualSimilarity(html, dna, architecture, system).catch(() => null);
    const brandPart = scoreBrandAdherence(html, brand, architecture, dna);
    return combineSimilarity(dnaPart, visual, brandPart);
  };

  const useRecipes = (system.recipes?.length ?? 0) > 0;

  if (useRecipes) {
    log(`recipe instantiation (${system.recipes.length} recipes available)`);
    const { html, architecture } = await generateRecipePage(request, dna, system, css, brand, log);
    let report = await scoreHtml(html, architecture);
    log(`recipe page: dna ${report.dnaSimilarity} · visual ${report.visualSimilarity} · brand ${report.brandSimilarity} · overall ${report.overallSimilarity}`);

    // Closed-loop visual repair until > 90.
    const repaired = await visualRepair(html, report, dna, (h) => scoreHtml(h, architecture), {
      target: 90,
      maxRounds: 3,
      log,
    });
    report = repaired.report;
    return { architecture, html: repaired.html, similarity: report, iterations: 1, repairRounds: repaired.rounds };
  }

  // Fallback: layout-driven architect + HTML generator.
  const maxIterations = opts.maxIterations ?? 3;
  const architecture = await architectPage(request, dna, system, brand);
  let best: { html: string; report: SimilarityReport } | null = null;
  let iterations = 0;
  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const html = await generateHtml(architecture, dna, system, css, { refineFrom: i > 0 && best ? best : undefined, brand });
    const report = await scoreHtml(html, architecture);
    log(`attempt ${iterations}: overall ${report.overallSimilarity}/100`);
    if (!best || report.overallSimilarity > best.report.overallSimilarity) best = { html, report };
    if (report.passed) break;
  }
  return { architecture, html: best!.html, similarity: best!.report, iterations, repairRounds: 0 };
}
