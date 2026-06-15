import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dbReady } from "@/lib/safe";

/** Serve a generated page's raw HTML (preview iframe + download). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!dbReady) return new NextResponse("DB not configured", { status: 503 });
  const { id } = await ctx.params;
  const page = await prisma.generatedPage.findUnique({ where: { id } });
  if (!page?.html) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(page.html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
