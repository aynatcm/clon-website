# Design DNA Platform

Analyze any website, extract its **Design DNA**, build a reusable **Design System**,
and generate new pages that visually belong to the same product.

This is **not** a website cloner. It is a Design DNA Extraction & Design System
Extension platform — it prioritizes *visual continuity over creativity*. Generated
pages should look like the original team designed them.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Prisma + PostgreSQL ·
Cloudflare R2 (S3) · Claude API + Vision · Playwright · Firecrawl · Cheerio ·
PostCSS · Zod · Inngest.

Every external service is **optional** — the platform degrades gracefully:

| Service        | Configured           | Not configured (fallback)                     |
|----------------|----------------------|-----------------------------------------------|
| Claude API     | Vision DNA synthesis | deterministic DNA from observed data          |
| Firecrawl      | sitemap + content    | Playwright-only crawl                         |
| Cloudflare R2  | object storage       | local disk under `.storage/`                  |
| PostgreSQL     | persistence + UI     | standalone CLI pipeline still runs            |

## The pipeline (Phases)

1. **Input** — URL (required) + optional screenshots / CSS / HTML / assets / brand notes.
2. **Multi-source analysis** — Playwright (primary), Firecrawl (secondary), uploads (fallback).
3. **Playwright crawl** — homepage + discovered key pages; desktop/tablet/mobile +
   nav/footer/section screenshots; CSS vars, fonts, computed styles, layout, grids, responsive.
4. **Design DNA schema** — Zod contract for `design-dna.json` (source of truth).
5. **Extraction engine** — PostCSS (CSS) + Cheerio (HTML) + token mining → grounded *Evidence*;
   Claude **Vision** over screenshots (highest-priority signal) synthesizes the DNA.
6. **Design System generation** — tokens + component/layout libraries + rules + self-contained CSS.
7. **DNA storage** — persisted as the permanent source of truth.
8–11. **Generation** — pick page + sections → architect from DNA → **similarity validation
   (≥85 gate)** → single production-ready HTML file. Generation is forbidden below 85.

## Run it

```bash
npm install
npx playwright install chromium
cp .env.example .env          # fill in what you have (all optional except DB for the UI)
```

### Standalone engines (no DB / no keys required)

```bash
npm run crawl  -- https://linear.app 2     # → .crawl-out/bundle.json + screenshots
npm run extract                            # → design-dna.json, design-system.json/.css
npx tsx scripts/generate.ts about          # → page-about.html + similarity report
```

### Full app (needs PostgreSQL)

```bash
# set DATABASE_URL in .env, then:
npm run db:push
npm run dev                                # http://localhost:3000
```

Add `ANTHROPIC_API_KEY` for Claude Vision DNA synthesis + AI page generation,
`FIRECRAWL_API_KEY` for sitemap discovery, and the `R2_*` vars for cloud storage.

For the durable queue path, run the Inngest dev server alongside `npm run dev`:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

(The UI also runs analysis inline via a server action, so Inngest is optional locally.)

## Validation status

- **Phase 3 crawler** — validated against `example.com` and `linear.app` (631 CSS vars,
  real fonts/palette/blocks, 14 screenshots).
- **Phase 5 extraction + deterministic DNA** — validated (Inter Variable 64px/510, real
  containers, pill corners, confidence 1.0).
- **Phase 6 design system** — validated (24 color tokens, font stacks, component classes, CSS).
- **Phases 8–11 generation** — validated (about/pricing pages, similarity 93/100, gate passing,
  well-formed self-contained HTML using brand fonts + `dna-*` classes).
- **UI** — `next build` passes; dev server renders with graceful no-DB fallback.

The DB-backed UI flow requires a PostgreSQL instance (none was available in the build
environment); the engines it orchestrates are fully validated via the standalone scripts.
