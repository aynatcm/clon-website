import type { BrandContext } from "@/lib/brand/schema";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";

/** Brand Context Package summary — voice, assets, copy, imagery (Phase 6.5). */
export function BrandPanel({ brand }: { brand: BrandContext }) {
  const v = brand.brandVoice;
  const roles = Array.from(new Set(brand.assets.map((a) => a.role)));
  const previews = brand.assets
    .filter((a) => /^https?:/.test(a.url) && a.role !== "logo")
    .slice(0, 4)
    .map((a) => ({ role: a.role, url: a.url }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Brand voice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-base">{v.tone}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="muted">{v.sentenceLength} sentences</Badge>
            <Badge tone="muted">tech {v.technicalDepth}</Badge>
            <Badge tone="muted">{v.conversionStyle}</Badge>
            <Badge tone={v.source === "ai" ? "success" : "muted"}>{v.source}</Badge>
          </div>
          {v.vocabulary.length > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-foreground)]">Vocabulary:</span> {v.vocabulary.slice(0, 10).join(", ")}
            </p>
          )}
          {v.trustSignals.length > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-foreground)]">Trust:</span> {v.trustSignals.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imagery &amp; assets ({brand.assets.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-[var(--color-muted)]">{brand.screenshotAnalysis.imageryStyle} · {brand.screenshotAnalysis.productPresentationStyle}</p>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <Badge key={r} tone="default">
                {r} ×{brand.assets.filter((a) => a.role === r).length}
              </Badge>
            ))}
          </div>
          {previews.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {previews.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p.url} alt={p.role} className="h-16 w-full rounded-md border border-[var(--color-border)] object-cover" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Copy library</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {brand.headlines.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Headlines</p>
              <ul className="space-y-0.5">
                {brand.headlines.slice(0, 5).map((h, i) => (
                  <li key={i} className="truncate">“{h}”</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-[var(--color-muted)]">
            {brand.features.length > 0 && <span>{brand.features.length} feature names</span>}
            <span>CTA: {brand.ctaPatterns.filter((c) => !c.endsWith("-cta")).slice(0, 4).join(", ") || "—"}</span>
            <span>{brand.copyLibrary.length} copy items</span>
          </div>
          {brand.forbiddenPhrases.length > 0 && (
            <p className="text-[10px] text-[var(--color-muted)]">
              Generator avoids {brand.forbiddenPhrases.length} generic phrases (e.g. “{brand.forbiddenPhrases.slice(0, 3).join("”, “")}”).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
