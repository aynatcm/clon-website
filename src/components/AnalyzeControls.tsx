"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeNow } from "@/actions/projects";
import { Button, Progress } from "@/components/ui";

const PROGRESS: Record<string, number> = {
  DRAFT: 0,
  CRAWLING: 25,
  EXTRACTING: 50,
  SYNTHESIZING: 70,
  BUILDING: 88,
  READY: 100,
  FAILED: 100,
};

const IN_PROGRESS = ["CRAWLING", "EXTRACTING", "SYNTHESIZING", "BUILDING"];

export function AnalyzeControls({ projectId, status }: { projectId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  // Poll while the pipeline is in progress.
  useEffect(() => {
    if (!IN_PROGRESS.includes(status)) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [status, router]);

  const busy = pending || running || IN_PROGRESS.includes(status);

  return (
    <div className="space-y-3">
      <Progress value={PROGRESS[status] ?? 0} />
      <div className="flex items-center gap-3">
        <Button
          disabled={busy}
          onClick={() => {
            setRunning(true);
            startTransition(async () => {
              try {
                await analyzeNow(projectId);
              } finally {
                setRunning(false);
                router.refresh();
              }
            });
          }}
        >
          {busy ? "Analyzing…" : status === "READY" ? "Re-analyze" : "Run analysis"}
        </Button>
        <span className="text-sm text-[var(--color-muted)]">
          {busy ? "Crawling, extracting, synthesizing DNA…" : `Status: ${status}`}
        </span>
      </div>
    </div>
  );
}
