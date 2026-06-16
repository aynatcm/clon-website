# Design DNA Platform — Project Context

A SaaS platform that analyzes any website, extracts its **Design DNA**, builds a
reusable **Design System** + **Brand Context** + **Section Recipes**, and generates
new pages that look and read as if the original company's team made them.

This is **not** a website cloner. It is a **Design-language Extension Engine**:
visual + brand continuity over creativity. The guiding test — *"would a designer
from the original company believe this page belongs to their product?"*

> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (original system design),
> [README.md](README.md) (quick start). This file is the full current picture.

---

## 1. What it does (end to end)

```
URL (+ optional screenshots / CSS / HTML / brand notes)
   │
   ▼  Phase 3   Playwright crawl  ── screenshots (desktop/tablet/mobile/nav/footer/section),
   │                                 computed styles, CSS vars, fonts, layout, color signals,
   │                                 section fingerprints, component fingerprints, assets, copy
   ▼  Phase 4   Firecrawl (secondary, optional) ── sitemap + content
   ▼  Phase 5   Extraction engine  ── PostCSS + Cheerio + token mining → grounded Evidence
   ▼  Phase 4.5 Visual Brand Analysis (Claude Vision) ── outranks CSS
   ▼  Phase 5/7 Design DNA synthesis (Zod-validated design-dna.json = source of truth)
   ▼  Phase 6   Design System (tokens + component/layout libs + rules + self-contained CSS)
   ▼  Phase 6.5 Brand Context Package (assets, copy library, brand voice, screenshot analysis, patterns)
   ▼  Phase 7.5 Section Recipes + Content DNA (structural templates + content patterns)
   │
   ▼  Generation (on demand)
        request (page type + sections + brief)
          → resolve detected Recipes
          → fill CONTENT slots only (AI or heuristic)
          → instantiate recipe structure (deterministic)
          → similarity scoring (DNA + visual + brand)
          → closed-loop visual repair until similarity > 90
          → single production-ready HTML file
```

Core principle progression across the build:
1. **Design System Generator** → recolored generic templates (early).
2. **Layout-driven** → instantiate detected layouts, not generic sections.
3. **Brand Extension Engine** → inherit real assets, copy, voice, imagery.
4. **Recipe Engine (current)** → generation = recipe instantiation; AI only fills
   content slots; layout/hierarchy/spacing/CTA-count/media/cards come from recipes.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling / UI | Tailwind v4 + shadcn-style primitives (`src/components/ui`) |
| Backend | Next.js Server Actions |
| DB / ORM | PostgreSQL + **Prisma 6** (pinned — see Gotchas) |
| Object storage | Cloudflare R2 (S3 API) with **local-disk fallback** |
| AI (text + vision) | Claude API (`@anthropic-ai/sdk`) |
| Crawl (primary) | Playwright (Chromium) |
| Crawl (secondary) | Firecrawl REST |
| HTML / CSS parsing | Cheerio / PostCSS + culori |
| Validation | Zod (every AI boundary + every DB JSON blob) |
| Queue / durability | Inngest 4 (optional locally) |

Every external service is **optional** — the platform degrades gracefully
(`src/lib/env.ts` exposes `features` flags).

| Service | Configured | Fallback when absent |
|---|---|---|
| Claude API | Vision DNA + brand voice + AI slot-fill + visual repair | deterministic everything |
| Firecrawl | sitemap + content | Playwright-only |
| Cloudflare R2 | object storage | local disk `.storage/` |
| PostgreSQL | persistence + UI | standalone CLI pipeline still runs |

---

## 3. Directory map

```
src/
  app/
    page.tsx                        landing / project list
    projects/new/page.tsx           Phase 1 input form
    projects/[id]/page.tsx          status + DNA viewer + Brand panel + screenshots
    projects/[id]/generate/page.tsx page generator UI + results
    api/inngest/route.ts            Inngest serve endpoint
    api/storage/[...key]/route.ts   serves local-disk artifacts (R2 fallback)
    api/pages/[id]/route.ts         serves a generated page's raw HTML
  actions/
    projects.ts                     createProject, analyzeNow, queueAnalysis, delete
    generate.ts                     createGeneration (loads DNA+system+brand → generatePage)
  components/
    ui/index.tsx                    Button/Card/Input/Badge/Progress/...
    AnalyzeControls.tsx             run analysis + poll status (client)
    DnaViewer.tsx                   philosophy/colors+evidence/typography/components/confidence
    BrandPanel.tsx                  voice / assets / copy library (Phase 6.5)
    GenerateForm.tsx                page type + sections + brief (client)
  lib/
    env.ts            Zod env + feature flags          db.ts   Prisma singleton
    safe.ts           graceful no-DB query wrapper      utils.ts cn()
    storage/r2.ts     R2 + local-disk storage
    ai/claude.ts      structured() (schema-validated) + complete() + vision
    crawler/          types.ts · pageScript.ts (in-browser extract) · index.ts (orchestrator)
    firecrawl/        secondary crawl client
    extraction/       css.ts (PostCSS) · html.ts (Cheerio) · evidence.ts · index.ts
    dna/              schema.ts (Design DNA Zod) · deterministic.ts · visual.ts · synthesize.ts
    designsystem/     schema.ts · index.ts (tokens + libs + CSS + recipes/contentPattern)
    brand/            schema.ts · index.ts (Brand Context: assets/copy/voice/screenshot analysis)
    recipe/           schema.ts · index.ts (buildRecipeBook) · slots.ts (AI content-only) · render.ts
    generation/       schema.ts · architect.ts · html.ts · render.ts · recipeGen.ts ·
                      similarity.ts · visualSimilarity.ts · repair.ts · index.ts (orchestrator)
    pipeline.ts       full analysis pipeline (crawl→…→recipes), DB-backed
  inngest/            client.ts · functions.ts (durable analyze wrapper)
prisma/schema.prisma  Project, Source, CrawlPage, Screenshot, DesignDna,
                      DesignSystem, BrandContext, GeneratedPage
scripts/              crawl.ts · extract.ts · generate.ts (standalone, no DB/keys)
```

---

## 4. Data model (Prisma)

- **Project** — one analyzed site + status (`DRAFT→CRAWLING→EXTRACTING→SYNTHESIZING→BUILDING→READY/FAILED`).
- **Source** — every input artifact (URL, screenshot, CSS, HTML, brand notes, asset).
- **CrawlPage** — captured page + structured extract JSON.
- **Screenshot** — viewport/section captures (R2 or local key).
- **DesignDna** — synthesized `design-dna.json` (source of truth) + confidence.
- **DesignSystem** — tokens + component/layout libs + rules + CSS + **recipes** + **contentPattern**.
- **BrandContext** — assets, copyLibrary, brandVoice, screenshotAnalysis, patterns, forbiddenPhrases.
- **GeneratedPage** — request, architecture, similarity, score, status, final HTML, iterations.

---

## 5. Key concepts

### Design DNA (`src/lib/dna/schema.ts`)
Validated object: `designPhilosophy`, `brandPersonality`, `visualAnalysis`,
`colors` (with **evidence trail** per decision + ignored WP/neutral colors),
`typography`, `spacing`, `layout`, `components` (variant fingerprints),
`sections` (type + structural fingerprint), `visualRules`, `confidenceReport`.

- **Colors by visual importance, not frequency** — brand color inferred from
  CTA/nav/hero/links (e.g. Linear → `#e4f222`), excluding WordPress/Gutenberg/
  near-white/near-black. Every color carries `{value, evidence[], confidence}`.
- **Visual analysis outranks CSS** — Claude Vision runs before synthesis; if CSS
  and screenshots disagree, screenshots win.
- **Confidence report** — grounded vs inferred data + per-decision explanations.

### Design System (`src/lib/designsystem/`)
Deterministic projection of the DNA → semantic color tokens, font stacks,
spacing/radii/shadow/container tokens, component classes carrying **measured
fingerprints** (the real CTA pill radius, card padding, etc.), layout library
with structural variants, machine rules, and a single self-contained CSS string.

### Brand Context (Phase 6.5, `src/lib/brand/`)
The "feels like the same company" layer: real **assets** (with inferred roles:
hero-image/product-shot/dashboard/logo/team-photo/…), **copy library**,
**brand voice** (tone, sentence length, technical depth, vocabulary, conversion
style — Claude or heuristic), **screenshot analysis** (imagery/product
presentation), patterns, and **forbidden generic phrases** ("Get started", etc.).

### Section Recipes + Content DNA (Phase 7.5, `src/lib/recipe/`)
A **Section Recipe** is a complete structural template captured from the source:
columns, media placement, CTA count, card structure (count + per-card slots +
icon/cta), spacing, alignment, and an ordered **content-slot graph**.
**Content DNA** = how the brand structures copy (headline/sub/cta/feature patterns).
Generation instantiates the recipe verbatim; AI only fills the content slots.

### Generation (`src/lib/generation/`)
`generatePage()` routes through **recipe instantiation** when recipes exist:
resolve request→recipes → `fillSlots()` (AI content-only / heuristic) →
`renderRecipeSection()` (deterministic structure) → assemble → score → repair.
Legacy layout-driven path (`architect.ts` + `html.ts` + `render.ts`) is the
fallback when no recipes are present.

### Similarity (`src/lib/generation/similarity.ts` + `visualSimilarity.ts`)
Three layers combined with weights **layout 30 · visual 25 · brand 25 · typography 10 · spacing 10**:
- **DNA adherence** (string) — uses tokens/classes/structure.
- **Visual** (rendered) — re-render generated HTML in Chromium, re-extract, compare
  colors/corners/fonts/**structural layout fidelity**. Anti-inflation: real render, not string match.
- **Brand** — voice (no forbidden phrases + vocabulary reuse), content (real copy
  reuse), asset usage (real `<img>`, empty media penalized), visual language (motif reuse).
- **Structural-completeness gate** — layout score capped at ≤90 unless the rendered
  page contains every required structural element (split content+visual columns,
  pricing repeated cards, logo-cloud repeated logos, contact form, non-empty media).

### Closed-loop visual repair (`src/lib/generation/repair.ts`)
Screenshot generated page + original reference screenshot → Claude Vision returns a
**targeted CSS-override patch** (overrides only, never structural — recipes stay
intact) → apply → re-score → loop until `overallSimilarity > 90` or 3 rounds.
AI + reference-screenshot gated; skips gracefully without a key.

### Media rules
Media-bearing sections always get a visual: a **real extracted asset** `<img>`
when available, else a style-matched inline artifact (dashboard mockup / chart /
code / UI panel). An empty `<div class="dna-media"></div>` is never emitted and
trips the completeness gate.

---

## 6. How to use it

### Install
```bash
npm install
npx playwright install chromium
cp .env.example .env          # all optional except DATABASE_URL for the UI
```

### A) Standalone engines — no DB, no API keys (fastest way to see it work)
```bash
npm run crawl  -- https://linear.app 2      # → .crawl-out/bundle.json + screenshots
npm run extract                             # → design-dna.json, design-system.json,
                                            #   design-system.css, brand-context.json, recipe-book.json
npx tsx scripts/generate.ts about "hero,story,team,cta"
                                            # → .crawl-out/page-about.html + similarity report
```
`scripts/generate.ts` loads the persisted `design-system.json` (which carries the
recipes) — recipe instantiation only triggers when recipes are present.

### B) Full app — needs PostgreSQL
```bash
# set DATABASE_URL in .env, then:
npm run db:push
npm run dev                                 # http://localhost:3000
```
Flow in the UI: **New analysis** (enter URL) → **Run analysis** (crawls + builds
DNA/system/brand/recipes, polls status) → project page shows DNA + Brand panel →
**Generate a page** (pick type + sections + brief) → preview + download HTML.

Optional durable queue:
```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```
(The UI also runs analysis inline via a server action, so Inngest is optional.)

### Enabling AI / cloud (drop into `.env`)
- `ANTHROPIC_API_KEY` → Vision DNA synthesis, brand voice, AI slot-fill, visual repair.
- `FIRECRAWL_API_KEY` → sitemap/content discovery.
- `R2_*` → cloud object storage (else local `.storage/`).
- `SIMILARITY_THRESHOLD` (default 85) — pass gate; repair loop targets 90.

### npm scripts
`dev`, `build`, `start`, `lint`, `typecheck`, `db:generate`, `db:push`,
`db:migrate`, `crawl`, `extract`.

---

## 7. Status

### Done
- Phases 1–11 implemented end to end.
- Crawler: 3 viewports + nav/footer/section shots; CSS vars, computed styles,
  importance-weighted color signals, advanced section fingerprints (~20 types),
  component variant fingerprints, assets, copy library.
- Extraction → grounded Evidence (PostCSS + Cheerio + token mining).
- Design DNA: importance colors + evidence, brand personality, visual analysis
  (vision-first), confidence report. Deterministic fallback always valid.
- Design System: tokens + measured component fingerprints + layout library + CSS.
- Brand Context (6.5): assets/copy/voice/screenshot analysis/patterns + forbidden phrases.
- Section Recipes + Content DNA (7.5): generation = recipe instantiation, AI fills slots only.
- Similarity: 3 layers, structural-completeness gate, requirement weighting.
- Closed-loop visual repair to >90 (AI-gated).
- UI: project list, input form, DNA viewer, Brand panel, generator + preview/download.
- Persistence (Prisma) + Inngest durable pipeline + R2/local storage.
- Validated standalone against `example.com` and `linear.app`:
  recipe-instantiated page **overall 95** (layout 100, brand 96, real Linear `<img>`,
  team grid w/ icon cards, real brand copy, 0 forbidden phrases, 0 empty media).
- `npm run build` + `tsc --noEmit` pass.

### Pending / not yet validated
- **DB-backed UI not run end to end** — no PostgreSQL/Docker in the build
  environment. UI compiles + renders with graceful no-DB fallback; the engines it
  orchestrates are fully validated via the standalone scripts. To finish: provide
  `DATABASE_URL`, `npm run db:push`, exercise the UI.
- **AI paths exercised only structurally** — vision DNA, AI brand voice, AI
  slot-fill, and the vision repair loop run only with `ANTHROPIC_API_KEY`. Logic
  is wired + falls back deterministically; not run against the live API here.
- **File uploads** (screenshots/CSS/HTML) are stored as Sources but uploaded
  screenshots don't yet feed Vision (only crawler screenshots do).
- `repairRounds` is returned by `generatePage` but not persisted on `GeneratedPage`.
- No automated test suite (validation is via the three CLI scripts).
- No auth / multi-tenant / rate limiting (single-user tool).
- Remote asset `<img>` URLs point at the source origin (hotlink) — fine for
  continuity demos; not re-hosted to R2.

---

## 8. Gotchas / decisions to know

- **Prisma pinned to v6.** v7 removed `url = env(...)` from the schema (needs a
  driver adapter + `prisma.config.ts`). Don't "upgrade" without rewiring.
- **Inngest v4** — `createFunction` takes 2 args; trigger goes inside options as
  `triggers: [{ event }]`.
- **Playwright `page.evaluate` + tsx** — esbuild's `keepNames` injects a `__name`
  helper into serialized functions; the crawler/visual-similarity polyfill it via
  `addInitScript` (identity). Keep that when touching in-page code.
- **Generation source of truth lives in the persisted `DesignSystem`** (recipes +
  contentPattern). Rebuilding the system from DNA alone loses recipes → falls back
  to the legacy layout path. The generate script loads `design-system.json`.
- **Colors are importance-based, never frequency-based** — keep new color logic in
  `evidence.ts inferColorRoles()`; don't reintroduce frequency ranking for brand colors.
- **AI is allowed to produce content only during recipe generation** (`recipe/slots.ts`).
  Structure must always come from recipes — don't let the generator emit layout from a prompt.
- Working artifacts land in `.crawl-out/` and `.storage/` (git-ignored).

---

## 9. Where to look first when extending

| I want to… | Start in |
|---|---|
| Change what's captured from pages | `src/lib/crawler/pageScript.ts` |
| Change color/section/component aggregation | `src/lib/extraction/evidence.ts` |
| Change the DNA shape | `src/lib/dna/schema.ts` (+ deterministic.ts, synthesize.ts) |
| Change tokens/CSS | `src/lib/designsystem/index.ts` |
| Change brand voice / assets / patterns | `src/lib/brand/index.ts` |
| Change recipes / content DNA | `src/lib/recipe/index.ts` |
| Change how pages render | `src/lib/recipe/render.ts` (+ generation/render.ts legacy) |
| Change what AI writes | `src/lib/recipe/slots.ts` (content-only) |
| Change scoring / gates / weights | `src/lib/generation/similarity.ts` + `visualSimilarity.ts` |
| Change the repair loop | `src/lib/generation/repair.ts` |
| Change the pipeline order | `src/lib/pipeline.ts` |
