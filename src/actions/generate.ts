"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { buildDesignSystem } from "@/lib/designsystem";
import { DesignSystemSchema } from "@/lib/designsystem/schema";
import { DesignDnaSchema } from "@/lib/dna/schema";
import { generatePage, GenerationRequestSchema } from "@/lib/generation";

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

  const [dnaRow, sysRow] = await Promise.all([
    prisma.designDna.findUnique({ where: { projectId } }),
    prisma.designSystem.findUnique({ where: { projectId } }),
  ]);
  if (!dnaRow) throw new Error("Design DNA not ready for this project");

  const dna = DesignDnaSchema.parse(dnaRow.data);
  let system;
  let css: string;
  if (sysRow?.css) {
    system = DesignSystemSchema.parse(sysRow.data);
    css = sysRow.css;
  } else {
    const built = buildDesignSystem(dna);
    system = built.system;
    css = built.css;
  }

  const gen = await prisma.generatedPage.create({
    data: { projectId, pageType: request.pageType, request: request as unknown as object, status: "GENERATING" },
  });

  try {
    const result = await generatePage(request, dna, system, css);
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
