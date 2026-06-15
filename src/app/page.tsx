import Link from "next/link";
import { prisma } from "@/lib/db";
import { safeDb, dbReady } from "@/lib/safe";
import { features } from "@/lib/env";
import { Card, CardContent, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "default" | "success" | "warn" | "muted"> = {
  READY: "success",
  FAILED: "warn",
  DRAFT: "muted",
};

export default async function Home() {
  const projects = await safeDb(
    () =>
      prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { generatedPages: true } } },
      }),
    [],
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Design DNA Platform</h1>
        <p className="mt-2 max-w-2xl text-[var(--color-muted)]">
          Analyze any website, extract its <strong>Design DNA</strong>, build a reusable Design System, and generate new
          pages that visually belong to the same product. Extension over imitation.
        </p>
        <div className="mt-4">
          <Link
            href="/projects/new"
            className="inline-flex h-10 items-center rounded-[10px] bg-[var(--color-primary)] px-5 text-sm font-medium text-[var(--color-primary-fg)]"
          >
            Analyze a website →
          </Link>
        </div>
      </section>

      {!dbReady && (
        <Card className="border-amber-500/40">
          <CardContent className="text-sm">
            <strong className="text-amber-600">Database not configured.</strong> Set <code>DATABASE_URL</code> in{" "}
            <code>.env</code> and run <code>npm run db:push</code> to enable project persistence. The extraction and
            generation engines also run standalone via <code>npm run crawl</code> / <code>npm run extract</code>.
          </CardContent>
        </Card>
      )}

      <FeatureStatus />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-[var(--color-muted)]">No projects yet. Start a new analysis.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="h-full transition hover:shadow-md">
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium">{p.name}</span>
                      <Badge tone={STATUS_TONE[p.status] ?? "default"}>{p.status}</Badge>
                    </div>
                    <p className="truncate text-xs text-[var(--color-muted)]">{p.url}</p>
                    <p className="text-xs text-[var(--color-muted)]">{p._count.generatedPages} generated pages</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FeatureStatus() {
  const items = [
    { label: "Claude AI", on: features.ai },
    { label: "Firecrawl", on: features.firecrawl },
    { label: "Cloudflare R2", on: features.r2 },
    { label: "Database", on: features.db },
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((i) => (
        <Badge key={i.label} tone={i.on ? "success" : "muted"}>
          {i.label}: {i.on ? "on" : "fallback"}
        </Badge>
      ))}
    </div>
  );
}
