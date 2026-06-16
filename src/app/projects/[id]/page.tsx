import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeDb, dbReady } from "@/lib/safe";
import { objectUrl } from "@/lib/storage/r2";
import { DesignDnaSchema } from "@/lib/dna/schema";
import { DesignSystemSchema } from "@/lib/designsystem/schema";
import { BrandContextSchema } from "@/lib/brand/schema";
import { AnalyzeControls } from "@/components/AnalyzeControls";
import { DnaViewer } from "@/components/DnaViewer";
import { BrandPanel } from "@/components/BrandPanel";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!dbReady) {
    return (
      <Card className="border-amber-500/40">
        <CardContent className="text-sm">Database not configured — set <code>DATABASE_URL</code> and run <code>npm run db:push</code>.</CardContent>
      </Card>
    );
  }

  const project = await safeDb(
    () =>
      prisma.project.findUnique({
        where: { id },
        include: {
          designDna: true,
          designSystem: true,
          brandContext: true,
          screenshots: { take: 12, orderBy: { createdAt: "asc" } },
          _count: { select: { pages: true, screenshots: true, generatedPages: true } },
        },
      }),
    null,
  );
  if (!project) notFound();

  const dna = project.designDna ? DesignDnaSchema.safeParse(project.designDna.data) : null;
  const system = project.designSystem ? DesignSystemSchema.safeParse(project.designSystem.data) : null;
  const brand = project.brandContext ? BrandContextSchema.safeParse(project.brandContext.data) : null;

  const shots = await Promise.all(
    project.screenshots.map(async (s) => ({ ...s, url: await objectUrl(s.storageKey) })),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <a href={project.url} target="_blank" rel="noreferrer" className="text-sm text-[var(--color-primary)]">
            {project.url}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={project.status === "READY" ? "success" : project.status === "FAILED" ? "warn" : "default"}>
            {project.status}
          </Badge>
          {project.status === "READY" && (
            <Link href={`/projects/${project.id}/generate`}>
              <Button>Generate a page →</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <AnalyzeControls projectId={project.id} status={project.status} />
          {project.error && <p className="mt-3 text-sm text-amber-600">Error: {project.error}</p>}
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            {project._count.pages} pages crawled · {project._count.screenshots} screenshots ·{" "}
            {project._count.generatedPages} generated pages
          </p>
        </CardContent>
      </Card>

      {dna?.success && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Design DNA</h2>
            <span className="text-xs text-[var(--color-muted)]">
              confidence {(project.designDna!.confidence * 100).toFixed(0)}% · sources{" "}
              {dna.data.provenance.sources.join(", ")}
            </span>
          </div>
          <DnaViewer dna={dna.data} system={system?.success ? system.data : undefined} />
        </section>
      )}

      {brand?.success && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Brand Context (Phase 6.5)</h2>
          <BrandPanel brand={brand.data} />
        </section>
      )}

      {!dna?.success && (
        project.status !== "READY" && (
          <Card>
            <CardContent className="text-sm text-[var(--color-muted)]">
              Run the analysis to extract this site&apos;s Design DNA.
            </CardContent>
          </Card>
        )
      )}

      {shots.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Captured screenshots</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.label ?? s.kind} className="h-40 w-full object-cover object-top" />
                <CardContent className="py-2 text-xs text-[var(--color-muted)]">
                  {s.kind} · {s.label}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
