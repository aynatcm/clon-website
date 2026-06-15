"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { runAnalysis } from "@/lib/pipeline";
import { projectKey, putObject } from "@/lib/storage/r2";
import type { SourceKind } from "@prisma/client";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(3),
  brandNotes: z.string().optional(),
  css: z.string().optional(),
  html: z.string().optional(),
});

/** Phase 1 — collect input + store everything, then create the project. */
export async function createProject(formData: FormData): Promise<{ id: string }> {
  const parsed = CreateSchema.parse({
    name: formData.get("name"),
    url: formData.get("url"),
    brandNotes: formData.get("brandNotes") || undefined,
    css: formData.get("css") || undefined,
    html: formData.get("html") || undefined,
  });

  let url = parsed.url.trim();
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;

  const project = await prisma.project.create({
    data: {
      name: parsed.name,
      url,
      status: "DRAFT",
      sources: {
        create: [
          { kind: "URL" as SourceKind, label: url },
          ...(parsed.css ? [{ kind: "CSS" as SourceKind, label: "pasted.css", text: parsed.css }] : []),
          ...(parsed.html ? [{ kind: "HTML" as SourceKind, label: "pasted.html", text: parsed.html }] : []),
          ...(parsed.brandNotes
            ? [{ kind: "BRAND_GUIDELINE" as SourceKind, label: "brand notes", text: parsed.brandNotes }]
            : []),
        ],
      },
    },
  });

  // Optional uploaded screenshot/asset files.
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = projectKey(project.id, "uploads", file.name);
    await putObject(key, buf, file.type || "application/octet-stream");
    const kind: SourceKind = file.type.startsWith("image/") ? "SCREENSHOT" : "ASSET";
    await prisma.source.create({
      data: { projectId: project.id, kind, label: file.name, storageKey: key, mimeType: file.type, bytes: buf.length },
    });
  }

  revalidatePath("/");
  return { id: project.id };
}

/** Form-action wrapper: create the project then go to its detail page. */
export async function createProjectAndRedirect(formData: FormData): Promise<void> {
  const { id } = await createProject(formData);
  redirect(`/projects/${id}`);
}

/** Queue analysis via Inngest (production path). */
export async function queueAnalysis(projectId: string): Promise<void> {
  await inngest.send({ name: "project/analyze", data: { projectId } });
}

/**
 * Run analysis inline (reliable local path without the Inngest dev server).
 * Long-running; the UI shows progress by polling project status.
 */
export async function analyzeNow(projectId: string): Promise<void> {
  await runAnalysis(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProject(projectId: string): Promise<void> {
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/");
}
