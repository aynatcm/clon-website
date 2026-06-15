import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";

function Axis({ label, value, poles }: { label: string; value: number; poles: [string, string] }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-[var(--color-muted)]">
        <span>{poles[0]}</span>
        <span>{label}</span>
        <span>{poles[1]}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-black/10">
        <span
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[var(--color-primary)]"
          style={{ left: `calc(${Math.round(value * 100)}% - 6px)` }}
        />
      </div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="h-10 w-10 rounded-lg border border-[var(--color-border)]" style={{ background: color }} />
      <code className="text-[10px] text-[var(--color-muted)]">{color}</code>
    </div>
  );
}

export function DnaViewer({ dna, system }: { dna: DesignDna; system?: DesignSystem }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Design philosophy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{dna.designPhilosophy.summary}</p>
          <div className="flex flex-wrap gap-1.5">
            {dna.designPhilosophy.keywords.map((k) => (
              <Badge key={k} tone="muted">
                {k}
              </Badge>
            ))}
          </div>
          <div className="space-y-2 pt-2">
            <Axis label="" value={dna.designPhilosophy.minimalToExpressive} poles={["minimal", "expressive"]} />
            <Axis label="" value={dna.designPhilosophy.massToPremium} poles={["mass", "premium"]} />
            <Axis label="" value={dna.designPhilosophy.corporateToStartup} poles={["corporate", "startup"]} />
            <Axis label="" value={dna.designPhilosophy.denseToSpacious} poles={["dense", "spacious"]} />
            <Axis label="" value={dna.designPhilosophy.traditionalToModern} poles={["traditional", "modern"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Color DNA · {dna.colors.mode}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Importance-based decisions with evidence trail (problem 6) */}
          <div className="space-y-1.5">
            {Object.entries(dna.colors.decisions).map(([role, d]) =>
              d ? (
                <div key={role} className="flex items-center gap-2 text-xs">
                  <span className="h-5 w-5 shrink-0 rounded border border-[var(--color-border)]" style={{ background: d.value }} />
                  <span className="w-20 font-medium capitalize">{role}</span>
                  <code className="text-[var(--color-muted)]">{d.value}</code>
                  <span className="truncate text-[var(--color-muted)]">← {d.evidence.join(", ") || "—"}</span>
                </div>
              ) : null,
            )}
          </div>
          {dna.colors.ignored.length > 0 && (
            <p className="text-[10px] text-[var(--color-muted)]">
              Excluded from brand (WP/neutral): {dna.colors.ignored.slice(0, 8).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand personality</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-[var(--color-muted)]">
            visual analysis source: <Badge tone={dna.visualAnalysis.source === "vision" ? "success" : "muted"}>{dna.visualAnalysis.source}</Badge>
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {Object.entries(dna.brandPersonality).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="capitalize text-[var(--color-muted)]">{k.replace(/([A-Z])/g, " $1")}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Typography DNA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {dna.typography.fonts.map((f) => (
            <div key={`${f.family}-${f.role}`} className="flex items-center justify-between">
              <span style={{ fontFamily: f.family }}>{f.family}</span>
              <Badge tone="muted">
                {f.role} · {f.weights.join("/") || "—"}
              </Badge>
            </div>
          ))}
          <div className="pt-2 text-xs text-[var(--color-muted)]">
            base {dna.typography.baseSize} · align {dna.typography.defaultAlignment} · scale{" "}
            {dna.typography.scale.map((s) => s.fontSize).join(", ")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Layout &amp; spacing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Containers: {dna.layout.containers.join(", ")}</p>
          <p>Columns: {dna.layout.columns}</p>
          <p>Spacing unit: {dna.spacing.unit}px · density {dna.spacing.density}</p>
          <p>Scale: {dna.spacing.scale.slice(0, 8).join(", ")}</p>
          <p className="text-xs text-[var(--color-muted)]">
            corners {dna.visualRules.cornerStyle} · shadows {dna.visualRules.shadowStyle} · whitespace{" "}
            {dna.visualRules.whitespace}
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Components &amp; sections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {dna.components.map((c) => (
              <Badge key={c.type}>
                {c.type} · {c.variants.length} variant{c.variants.length === 1 ? "" : "s"}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dna.sections.map((s) => (
              <Badge key={s.type} tone="muted">
                {s.type} ×{s.frequency}
                {s.fingerprint?.columns ? ` · ${s.fingerprint.columns}col` : ""}
              </Badge>
            ))}
          </div>
          {system && (
            <p className="pt-2 text-xs text-[var(--color-muted)]">
              Design System: {Object.keys(system.tokens.colors).length} color tokens ·{" "}
              {system.components.length} component classes · {system.layouts.length} layouts
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Confidence report</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-xs md:grid-cols-2">
          <div>
            <p className="mb-1 font-medium text-emerald-600">Grounded ({dna.confidenceReport.groundedData.length})</p>
            <ul className="list-inside list-disc space-y-0.5 text-[var(--color-muted)]">
              {dna.confidenceReport.groundedData.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-amber-600">Inferred ({dna.confidenceReport.inferredData.length})</p>
            <ul className="list-inside list-disc space-y-0.5 text-[var(--color-muted)]">
              {dna.confidenceReport.inferredData.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-2">
            <Badge tone="muted">visual {Math.round(dna.confidenceReport.visualConfidence * 100)}%</Badge>
            <Badge tone="muted">structural {Math.round(dna.confidenceReport.structuralConfidence * 100)}%</Badge>
            <Badge tone="default">overall {Math.round(dna.confidenceReport.overallConfidence * 100)}%</Badge>
          </div>
          {dna.confidenceReport.explanations.map((e, i) => (
            <p key={i} className="md:col-span-2 text-[var(--color-muted)]">
              • {e}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
