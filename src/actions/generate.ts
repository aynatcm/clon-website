"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { DesignSystemSchema } from "@/lib/designsystem/schema";
import { DesignDnaSchema } from "@/lib/dna/schema";
import { BrandContextSchema } from "@/lib/brand/schema";
import { withEmbeddedScreenshotAssets } from "@/lib/brand/assets";
import { generatePage, GenerationRequestSchema } from "@/lib/generation";
import { getObjectBuffer } from "@/lib/storage/r2";

/**
 * Phases 8-11 — generate a page from a project's stored Design DNA + System.
 * Persists architecture, similarity, score and final HTML. Pages below the
 * similarity threshold are stored as REJECTED (generation gate).
 */
export async function createGeneration(
  projectId: string,
  input: { pageType: string; sections: string[]; brief: string; title?: string; audience?: string },
): Promise<{ id: string }> {
  const request = GenerationRequestSchema.parse(input);

  const [dnaRow, sysRow, brandRow] = await Promise.all([
    prisma.designDna.findUnique({ where: { projectId } }),
    prisma.designSystem.findUnique({ where: { projectId } }),
    prisma.brandContext.findUnique({ where: { projectId } }),
  ]);
  if (!dnaRow) throw new Error("Design DNA not ready for this project");
  if (!sysRow?.css) throw new Error("Design System recipes are not ready. Re-run analysis before generating pages.");

  const dna = DesignDnaSchema.parse(dnaRow.data);
  const system = DesignSystemSchema.parse(sysRow.data);
  const css = sysRow.css;
  if (!system.recipes?.length) throw new Error("Section Recipes are not ready. Re-run analysis before generating pages.");
  const brand = await withEmbeddedScreenshotAssets(brandRow ? BrandContextSchema.parse(brandRow.data) : undefined, getObjectBuffer);

  const gen = await prisma.generatedPage.create({
    data: { projectId, pageType: request.pageType, request: request as unknown as object, status: "GENERATING" },
  });

  try {
    const result = await generatePage(request, dna, system, css, { brand });
    await prisma.generatedPage.update({
      where: { id: gen.id },
      data: {
        architecture: result.architecture as unknown as object,
        similarity: result.similarity as unknown as object,
        score: result.similarity.overall,
        html: result.html,
        iterations: result.iterations,
        status: result.similarity.passed ? "READY" : "REJECTED",
      },
    });
  } catch (err) {
    await prisma.generatedPage.update({
      where: { id: gen.id },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 500) },
    });
  }

  revalidatePath(`/projects/${projectId}/generate`);
  return { id: gen.id };
}
