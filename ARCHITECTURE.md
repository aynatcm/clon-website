# Design DNA Platform — Architecture

A SaaS platform that analyzes any website, extracts its **Design DNA**, builds a
reusable **Design System**, and generates new pages that visually belong to the
same product. This is **design-language extension**, not website cloning. Visual
continuity is prioritized over creativity.

## High-level flow

```
                    ┌──────────────────────────────────────────────┐
 User input         │  URL + optional screenshots / CSS / HTML /     │
 (Phase 1)          │  assets / references / brand guidelines        │
                    └───────────────────────┬──────────────────────┘
                                             │  Server Action: createProject()
                                             ▼
                    ┌──────────────────────────────────────────────┐
 Ingestion          │  Project + Source rows persisted (Prisma)      │
                    │  Uploaded files → Cloudflare R2                │
                    └───────────────────────┬──────────────────────┘
                                             │  Inngest event: project/analyze
                                             ▼
   ┌─────────────────────── Analysis pipeline (Inngest, durable steps) ──────────────────────┐
   │                                                                                          │
   │  Phase 3  Playwright crawl ──► raw pages, computed styles, screenshots (desktop/        │
   │           (PRIMARY)            tablet/mobile), CSS vars, fonts, layout metrics           │
   │                                                                                          │
   │  Phase 4  Firecrawl (SECONDARY) ──► sitemap, content, metadata, recurring templates     │
   │                                                                                          │
   │  Fallbacks: uploaded screenshots / CSS / HTML / assets — never fail on missing source   │
   │                                                                                          │
   │  Phase 5  Extraction engine ──► merges all sources into a structured CrawlBundle:        │
   │           - CSS parsing (PostCSS)   - HTML parsing (Cheerio)                              │
   │           - color / type / spacing / layout token mining                                 │
   │           - component + section detection                                                │
   │           - Claude Vision over screenshots (Visual DNA, HIGHEST priority)                │
   │                                                                                          │
   │  Phase 5/7 Design DNA synthesis (Claude) ──► validated design-dna.json (Zod)             │
   │                                                                                          │
   │  Phase 6  Design System generation ──► tokens, component lib, layout lib, rules          │
   │                                                                                          │
   └───────────────────────────────────────┬─────────────────────────────────────────────────┘
                                            │  DesignDNA + DesignSystem rows persisted
                                            ▼
                    ┌──────────────────────────────────────────────┐
 Generation         │  Phase 8  user picks page type + sections      │
 (on demand)        │  Phase 9  page architecture from DNA            │
                    │  Phase 10 similarity validation (>= 85 gate)    │
                    │  Phase 11 production HTML (single file)         │
                    │  Final    "would their designer believe it?"   │
                    └──────────────────────────────────────────────┘
```

## Source priority

1. **Visual DNA** (Claude Vision over screenshots) — highest authority.
2. **Playwright** computed styles / DOM — ground truth for tokens.
3. **Firecrawl** — content, sitemap, template discovery.
4. **Uploaded** screenshots / CSS / HTML / assets — fallback + augmentation.

The pipeline degrades gracefully: any unavailable source is skipped, the run
continues on the best available data, and confidence scores reflect what was used.

## Technology stack

| Concern              | Choice                                            |
|----------------------|---------------------------------------------------|
| Framework            | Next.js (App Router) + TypeScript                 |
| Styling / UI         | Tailwind v4 + shadcn-style primitives             |
| Backend              | Next.js Server Actions                            |
| DB / ORM             | PostgreSQL + Prisma                               |
| Object storage       | Cloudflare R2 (S3 API via `@aws-sdk/client-s3`)   |
| AI text + synthesis  | Claude API (`@anthropic-ai/sdk`)                  |
| AI vision            | Claude Vision (same SDK, image blocks)            |
| Crawl (primary)      | Playwright (Chromium)                             |
| Crawl (secondary)    | Firecrawl REST API                                |
| HTML parsing         | Cheerio                                           |
| CSS parsing          | PostCSS + culori (color math)                     |
| Validation           | Zod (every AI boundary + every DB JSON blob)      |
| Queue / durability   | Inngest                                           |

## Directory layout

```
src/
  app/
    page.tsx                     landing / project list
    projects/new/page.tsx        Phase 1 input form
    projects/[id]/page.tsx       analysis status + Design DNA viewer
    projects/[id]/generate/      Phase 8-11 page generator UI
    api/inngest/route.ts         Inngest serve endpoint
  actions/                       Server Actions (project, generate)
  lib/
    db.ts                        Prisma client singleton
    env.ts                       Zod-validated env + feature flags
    storage/r2.ts                Cloudflare R2 helpers
    ai/claude.ts                 Claude text + vision wrappers
    crawler/                     Phase 3 Playwright crawler
    firecrawl/                   Phase 4 Firecrawl client
    extraction/                  Phase 5 extraction engine
    dna/                         Design DNA schema (Zod) + synthesizer
    designsystem/                Phase 6 design system generator
    generation/                  Phase 8-11 page generation + similarity
  inngest/                       Inngest client + analysis function
  components/ui/                 shadcn-style primitives
prisma/
  schema.prisma                  Phase 2 database schema
```

## Data model (summary — see prisma/schema.prisma)

- **Project** — one analyzed website. Holds status + source URL.
- **Source** — every input artifact (url, screenshot, css, html, asset, brand).
- **CrawlPage** — one page captured by Playwright/Firecrawl + its raw extract.
- **Screenshot** — viewport/section captures stored in R2.
- **DesignDNA** — the synthesized, validated `design-dna.json` (source of truth).
- **DesignSystem** — tokens + component/layout libraries + rules derived from DNA.
- **GeneratedPage** — a produced page, its similarity score, and exported HTML.

## Determinism & safety

- Nothing is assumed. Colors / type / layout come only from observed data.
- Every Claude response is schema-validated; malformed output is retried.
- HTML generation is **forbidden below similarity score 85** (Phase 10 gate).
- All long work runs in Inngest steps so partial failures resume, not restart.
