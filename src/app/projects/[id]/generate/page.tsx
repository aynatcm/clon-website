import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeDb, dbReady } from "@/lib/safe";
import { DesignDnaSchema } from "@/lib/dna/schema";
import { SimilarityReportSchema } from "@/lib/generation/schema";
import { GenerateForm } from "@/components/GenerateForm";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui";

export const dynamic = "force-dynamic";

const SCORE_KEYS = ["typography", "layout", "component", "section", "visual", "brand", "spacing"] as const;

export default async function GeneratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!dbReady) {
    return <Card><CardContent className="text-sm">Database not configured.</CardContent></Card>;
  }

  const project = await safeDb(
    () =>
      prisma.project.findUnique({
        where: { id },
        include: { designDna: true, generatedPages: { orderBy: { createdAt: "desc" } } },
      }),
    null,
  );
  if (!project) notFound();
  if (!project.designDna) {
    return (
      <Card>
        <CardContent className="space-y-3 text-sm">
          <p>This project has no Design DNA yet.</p>
          <Link href={`/projects/${id}`}>
            <Button>Run analysis first</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const dna = DesignDnaSchema.parse(project.designDna.data);
  const dnaSections = Array.from(new Set([...dna.sections.map((s) => s.type), ...dna.components.map((c) => c.type)]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Generate pages</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Extending <Link href={`/projects/${id}`} className="text-[var(--color-primary)]">{project.name}</Link>
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GenerateForm projectId={id} dnaSections={dnaSections} />

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Generated pages</h2>
          {project.generatedPages.length === 0 ? (
            <Card>
              <CardContent className="text-sm text-[var(--color-muted)]">Nothing generated yet.</CardContent>
            </Card>
          ) : (
            project.generatedPages.map((g) => {
              const sim = g.similarity ? SimilarityReportSchema.safeParse(g.similarity) : null;
              return (
                <Card key={g.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="capitalize">{g.pageType}</CardTitle>
                    <Badge tone={g.status === "READY" ? "success" : g.status === "REJECTED" ? "warn" : "muted"}>
                      {g.status} · {g.score.toFixed(0)}/100
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {sim?.success && (
                      <>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div className="rounded-md bg-black/5 py-1.5">
                            <div className="font-semibold">{sim.data.dnaSimilarity}</div>
                            <div className="text-[var(--color-muted)]">DNA</div>
                          </div>
                          <div className="rounded-md bg-black/5 py-1.5">
                            <div className="font-semibold">{sim.data.visualSimilarity}</div>
                            <div className="text-[var(--color-muted)]">visual</div>
                          </div>
                          <div className="rounded-md bg-black/5 py-1.5">
                            <div className="font-semibold">{sim.data.brandSimilarity}</div>
                            <div className="text-[var(--color-muted)]">brand</div>
                          </div>
                          <div className="rounded-md bg-[var(--color-primary)]/10 py-1.5 text-[var(--color-primary)]">
                            <div className="font-semibold">{sim.data.overallSimilarity}</div>
                            <div>overall</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                          {SCORE_KEYS.map((k) => (
                            <div key={k} className="rounded-md bg-black/5 py-1">
                              <div className="font-semibold">{sim.data[k]}</div>
                              <div className="text-[var(--color-muted)]">{k.slice(0, 5)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {sim?.success && sim.data.issues.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-amber-600">
                        {sim.data.issues.map((i, idx) => (
                          <li key={idx}>{i}</li>
                        ))}
                      </ul>
                    )}
                    {g.html && (
                      <>
                        <iframe
                          src={`/api/pages/${g.id}`}
                          title={g.pageType}
                          className="h-72 w-full rounded-md border border-[var(--color-border)] bg-white"
                        />
                        <div className="flex gap-2">
                          <a href={`/api/pages/${g.id}`} target="_blank" rel="noreferrer">
                            <Button variant="secondary" size="sm">Open</Button>
                          </a>
                          <a href={`/api/pages/${g.id}`} download={`${g.pageType}.html`}>
                            <Button variant="outline" size="sm">Download HTML</Button>
                          </a>
                        </div>
                      </>
                    )}
                    {g.error && <p className="text-xs text-amber-600">{g.error}</p>}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
