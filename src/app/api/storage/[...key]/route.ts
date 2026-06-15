import { NextResponse } from "next/server";
import { getObjectBuffer } from "@/lib/storage/r2";

/** Serves locally-stored artifacts (screenshots) when R2 is not configured. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const { key } = await ctx.params;
  const objectKey = key.map(decodeURIComponent).join("/");
  try {
    const buf = await getObjectBuffer(objectKey);
    const ext = objectKey.split(".").pop()?.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
