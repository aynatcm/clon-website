import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { crawl } from "@/lib/crawler";
import { firecrawlSite } from "@/lib/firecrawl";
import { extract, type UploadedSource } from "@/lib/extraction";
import { synthesizeDna } from "@/lib/dna/synthesize";
import { buildDesignSystem } from "@/lib/designsystem";
import { buildBrandContext } from "@/lib/brand";
import { buildRecipeBook } from "@/lib/recipe";
import { projectKey, putObject } from "@/lib/storage/r2";
import type { ShotKind } from "@prisma/client";

/**
 * Full analysis pipeline (Phases 3-7). Callable directly (server action) or
 * step-wrapped by Inngest. Persists screenshots, crawl pages, the Design DNA,
 * and the Design System. Never hard-fails on a missing optional source.
 */
export async function runAnalysis(
  projectId: string,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { sources: true },
  });
  if (!project) throw new Error(`project ${projectId} not found`);

  try {
    await prisma.project.update({ where: { id: projectId }, data: { status: "CRAWLING", error: null } });

    // --- Phase 3: Playwright crawl ---
    let shotSeq = 0;
    const bundle = await crawl(project.url, {
      maxPages: env.CRAWL_MAX_PAGES,
      timeoutMs: env.CRAWL_TIMEOUT_MS,
      log,
      saveScreenshot: async (buf, meta) => {
        const key = projectKey(projectId, "screenshots", `${String(shotSeq++).padStart(3, "0")}-${meta.kind}.png`);
        await putObject(key, buf, "image/png");
        return key;
      },
    });

    // Persist crawl pages + screenshots.
    for (const page of bundle.pages) {
      const row = await prisma.crawlPage.create({
        data: {
          projectId,
          origin: "PLAYWRIGHT",
          url: page.url,
          title: page.extract.title ?? null,
          html: page.extract.rawHtml?.slice(0, 200_000) ?? null,
          extract: page.extract as unknown as object,
        },
      });
      for (const s of page.screenshots) {
        await prisma.screenshot.create({
          data: {
            projectId,
            pageId: row.id,
            kind: s.kind as ShotKind,
            storageKey: s.storageKey,
            width: s.width,
            height: s.height,
            label: s.label,
          },
        });
      }
    }

    // --- Phase 4: Firecrawl (secondary) ---
    const firecrawl = await firecrawlSite(project.url, { limit: 8 }).catch(() => undefined);
    if (firecrawl?.available) log(`firecrawl: ${firecrawl.pages.length} pages, ${firecrawl.sitemap.length} urls`);

    // --- Phase 5: extraction ---
    await prisma.project.update({ where: { id: projectId }, data: { status: "EXTRACTING" } });
    const uploaded: UploadedSource[] = project.sources
      .filter((s) => ["CSS", "HTML", "BRAND_GUIDELINE", "DESIGN_REFERENCE"].includes(s.kind))
      .map((s) => ({ kind: s.kind as UploadedSource["kind"], text: s.text ?? undefined }));
    const { evidence, brandNotes } = await extract({ bundle, firecrawl, uploaded, log });

    // --- Phase 5/7: DNA synthesis ---
    await prisma.project.update({ where: { id: projectId }, data: { status: "SYNTHESIZING" } });
    const dna = await synthesizeDna({ evidence, extraNotes: brandNotes });
    await prisma.designDna.upsert({
      where: { projectId },
      create: { projectId, data: dna as unknown as object, confidence: dna.provenance.confidence },
      update: { data: dna as unknown as object, confidence: dna.provenance.confidence },
    });

    // --- Phase 6.5: brand context package (assets, copy, voice, patterns) ---
    const brandContext = await buildBrandContext(evidence, dna);
    await prisma.brandContext.upsert({
      where: { projectId },
      create: { projectId, data: brandContext as unknown as object },
      update: { data: brandContext as unknown as object },
    });
    log(`brand context: ${brandContext.assets.length} assets, ${brandContext.copyLibrary.length} copy items, voice=${brandContext.brandVoice.tone}`);

    // --- Phase 6/7.5: design system + Section Recipes (Content DNA) ---
    await prisma.project.update({ where: { id: projectId }, data: { status: "BUILDING" } });
    const { system, css } = buildDesignSystem(dna);
    const book = buildRecipeBook(evidence, dna, brandContext);
    system.recipes = book.recipes;
    system.contentPattern = book.contentPattern;
    await prisma.designSystem.upsert({
      where: { projectId },
      create: { projectId, data: system as unknown as object, css },
      update: { data: system as unknown as object, css },
    });
    log(`recipes: ${book.recipes.length} section recipes (${book.recipes.map((r) => r.type).join(", ")})`);

    await prisma.project.update({ where: { id: projectId }, data: { status: "READY" } });
    log("analysis complete");
  } catch (err) {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}
