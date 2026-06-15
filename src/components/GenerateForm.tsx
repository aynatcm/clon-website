"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGeneration } from "@/actions/generate";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, Badge } from "@/components/ui";

const PAGE_TYPES = ["landing", "about", "pricing", "careers", "contact", "custom"];
const SECTION_OPTIONS = [
  "hero",
  "feature-grid",
  "logos",
  "stats",
  "testimonials",
  "pricing",
  "team",
  "story",
  "timeline",
  "cta",
  "form",
  "footer",
];

export function GenerateForm({ projectId, dnaSections }: { projectId: string; dnaSections: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pageType, setPageType] = useState("landing");
  const [sections, setSections] = useState<string[]>([]);
  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState("");

  const toggle = (s: string) =>
    setSections((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate a page</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Page type</Label>
          <div className="flex flex-wrap gap-2">
            {PAGE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPageType(t)}
                className={`rounded-full px-3 py-1 text-sm capitalize ${
                  pageType === t
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                    : "border border-[var(--color-border)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Sections {sections.length === 0 && <span className="text-[var(--color-muted)]">(auto if none selected)</span>}</Label>
          <div className="flex flex-wrap gap-2">
            {SECTION_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className={`rounded-full px-3 py-1 text-xs ${
                  sections.includes(s)
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                    : "border border-[var(--color-border)]"
                }`}
              >
                {s}
                {dnaSections.includes(s) && <span className="ml-1 opacity-70">●</span>}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">● = pattern present in this product&apos;s DNA</p>
        </div>

        <div>
          <Label htmlFor="title">Title / brand name</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme" />
        </div>

        <div>
          <Label htmlFor="brief">Brief / content requirements</Label>
          <Textarea
            id="brief"
            rows={4}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="A pricing page with three tiers (Starter, Team, Enterprise), a feature comparison, and an FAQ."
          />
        </div>

        <Button
          disabled={pending}
          size="lg"
          className="w-full"
          onClick={() =>
            start(async () => {
              await createGeneration(projectId, { pageType, sections, brief, title: title || undefined });
              setBrief("");
              router.refresh();
            })
          }
        >
          {pending ? "Generating & validating similarity…" : "Generate page →"}
        </Button>
        <p className="text-center text-xs text-[var(--color-muted)]">
          Generation is gated: HTML is only accepted at ≥85 similarity to the Design DNA.
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {dnaSections.map((s) => (
            <Badge key={s} tone="muted">
              {s}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
