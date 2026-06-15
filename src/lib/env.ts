import { z } from "zod";

/**
 * Central environment access. Every external service is OPTIONAL so the
 * platform degrades gracefully (Phase 2 rule: "never fail if a source is
 * unavailable"). `features` exposes which capabilities are wired.
 */
const schema = z.object({
  DATABASE_URL: z.string().optional(),

  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
  ANTHROPIC_VISION_MODEL: z.string().default("claude-opus-4-8"),

  // Firecrawl (secondary crawl source)
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_API_URL: z.string().default("https://api.firecrawl.dev"),

  // Cloudflare R2 (S3-compatible object storage)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  // Crawl limits
  CRAWL_MAX_PAGES: z.coerce.number().default(8),
  CRAWL_TIMEOUT_MS: z.coerce.number().default(30_000),

  // Similarity gate (Phase 10)
  SIMILARITY_THRESHOLD: z.coerce.number().default(85),

  NODE_ENV: z.string().default("development"),
});

const parsed = schema.parse(process.env);

export const env = parsed;

export const features = {
  ai: Boolean(parsed.ANTHROPIC_API_KEY),
  firecrawl: Boolean(parsed.FIRECRAWL_API_KEY),
  r2: Boolean(
    parsed.R2_ACCOUNT_ID &&
      parsed.R2_ACCESS_KEY_ID &&
      parsed.R2_SECRET_ACCESS_KEY &&
      parsed.R2_BUCKET,
  ),
  db: Boolean(parsed.DATABASE_URL),
} as const;

export type Features = typeof features;
