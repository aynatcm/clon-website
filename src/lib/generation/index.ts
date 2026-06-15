import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import { env } from "@/lib/env";
import { architectPage } from "./architect";
import { generateHtml } from "./html";
import { scoreDnaAdherence, combineSimilarity } from "./similarity";
import { visualSimilarity } from "./visualSimilarity";
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
}

/**
 * Phases 8-11 orchestration. Architect → generate → score → refine until the
 * similarity gate (>= threshold) passes or the refine budget is exhausted.
 * HTML below threshold is returned with passed=false so callers can mark the
 * page REJECTED (Phase 10: generation is forbidden below 85).
 */
export async function generatePage(
  rawRequest: unknown,
  dna: DesignDna,
  system: DesignSystem,
  css: string,
  opts: { maxIterations?: number; log?: (m: string) => void } = {},
): Promise<GenerationResult> {
  const log = opts.log ?? (() => {});
  const maxIterations = opts.maxIterations ?? 3;
  const request: GenerationRequest = GenerationRequestSchema.parse(rawRequest);

  log(`architecting ${request.pageType} page`);
  const architecture = await architectPage(request, dna, system);

  let best: { html: string; report: SimilarityReport } | null = null;
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    log(`generation attempt ${iterations}`);
    const html = await generateHtml(architecture, dna, system, css, {
      refineFrom: i > 0 && best ? best : undefined,
    });
    // Layer 1: DNA adherence (string). Layer 2: rendered visual similarity.
    const dnaPart = scoreDnaAdherence(html, architecture, dna, system);
    const visual = await visualSimilarity(html, dna, architecture, system).catch(() => null);
    const report = combineSimilarity(dnaPart, visual);
    log(
      `dna ${report.dnaSimilarity} · visual ${report.visualSimilarity} · overall ${report.overallSimilarity}/100 (threshold ${env.SIMILARITY_THRESHOLD})`,
    );

    if (!best || report.overallSimilarity > best.report.overallSimilarity) best = { html, report };
    if (report.passed) break;
  }

  return {
    architecture,
    html: best!.html,
    similarity: best!.report,
    iterations,
  };
}
