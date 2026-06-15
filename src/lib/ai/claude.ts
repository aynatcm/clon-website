import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env, features } from "@/lib/env";

/**
 * Claude wrappers for text synthesis + vision. Every structured call is
 * schema-validated and retried on malformed output. When no API key is present
 * the helpers throw a typed AiUnavailableError so callers can fall back to the
 * deterministic extraction path (Phase 2: never hard-fail on a missing source).
 */

export class AiUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY not configured — AI synthesis unavailable");
    this.name = "AiUnavailableError";
  }
}

let client: Anthropic | null = null;
function ai(): Anthropic {
  if (!features.ai) throw new AiUnavailableError();
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  return client;
}

export interface ImageInput {
  // base64 (no data: prefix) + media type, OR a URL.
  base64?: string;
  mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  url?: string;
}

function imageBlock(img: ImageInput): Anthropic.ImageBlockParam {
  if (img.url) {
    return { type: "image", source: { type: "url", url: img.url } };
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType ?? "image/png",
      data: img.base64!,
    },
  };
}

/** Extract the first balanced JSON object/array from a model response. */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced JSON in model output");
}

export interface StructuredOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  images?: ImageInput[];
  system?: string;
  retries?: number;
}

/**
 * Ask Claude for a JSON object validated against a Zod schema. Retries with the
 * validation error fed back to the model so it self-corrects.
 */
export async function structured<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts: StructuredOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const model = opts.model ?? env.ANTHROPIC_MODEL;
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of opts.images ?? []) content.push(imageBlock(img));
  content.push({ type: "text", text: prompt });

  let lastErr: unknown;
  let correction = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await ai().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      temperature: opts.temperature ?? 0.2,
      system:
        opts.system ??
        "You are a precise design-systems analyst. Respond with ONLY valid JSON matching the requested schema. No prose, no markdown fences.",
      messages: [
        { role: "user", content: attempt === 0 ? content : [...content, { type: "text", text: correction }] },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    try {
      const parsed = JSON.parse(extractJson(text));
      return schema.parse(parsed);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof z.ZodError ? JSON.stringify(err.issues).slice(0, 1500) : String(err);
      correction = `Your previous response failed validation: ${msg}\nReturn corrected JSON ONLY.`;
    }
  }
  throw new Error(`structured() failed after ${retries + 1} attempts: ${String(lastErr)}`);
}

/** Free-form text completion (used for HTML generation, Phase 11). */
export async function complete(
  prompt: string,
  opts: { model?: string; maxTokens?: number; temperature?: number; system?: string; images?: ImageInput[] } = {},
): Promise<string> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of opts.images ?? []) content.push(imageBlock(img));
  content.push({ type: "text", text: prompt });
  const res = await ai().messages.create({
    model: opts.model ?? env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.temperature ?? 0.3,
    system: opts.system ?? "You are an expert frontend engineer and UI designer.",
    messages: [{ role: "user", content }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export { features as aiFeatures };
