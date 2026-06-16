import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { isUsableAssetUrl } from "@/lib/brand/assets";
import type { PageArchitecture } from "./schema";

/**
 * LAYOUT-DRIVEN, self-contained HTML renderer. Each section INSTANTIATES a
 * detected layout from `system.layouts` (preserving its structural variant +
 * column count) and uses the measured component classes (dna-button/-card/
 * -input carry the real fingerprints). No generic per-type templates.
 */

export const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const gridClass = (cols: number) => `dna-grid dna-grid--${Math.max(2, Math.min(6, cols || 3))}`;

function slotPairs(slots: Record<string, string>): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  const titleKeys = Object.keys(slots).filter((k) => /title|name|label|stat|value|q\d|question/i.test(k));
  for (const k of titleKeys) {
    const base = k.replace(/title|name|label/i, "");
    out.push({ title: slots[k], body: slots[`${base}body`] ?? slots[`${base}desc`] ?? slots[`${base}description`] ?? slots[`${base}answer`] ?? "" });
  }
  return out.filter((p) => p.title);
}

// Real (non-lorem) deterministic copy pools per layout type, used only when the
// architecture provides no contentSlots (AI path supplies real copy itself).
const ITEM_COPY: Record<string, { title: string; body: string }[]> = {
  "feature-grid": [
    { title: "Built for speed", body: "Everything responds instantly, so your team stays in flow." },
    { title: "Designed to scale", body: "From first hire to thousands, the workflow grows with you." },
    { title: "Secure by default", body: "Encryption, audit logs and granular access out of the box." },
    { title: "Works with your stack", body: "Connect the tools you already use in a few clicks." },
  ],
  "service-grid": [
    { title: "Strategy", body: "We map the problem before we touch a pixel." },
    { title: "Design", body: "Interfaces that feel native to your brand." },
    { title: "Engineering", body: "Production-grade builds, shipped and maintained." },
  ],
  stats: [
    { title: "99.9%", body: "Uptime across all regions" },
    { title: "10k+", body: "Teams onboarded" },
    { title: "4.9/5", body: "Average customer rating" },
  ],
  "team-section": [
    { title: "Alex Rivera", body: "Founder & CEO" },
    { title: "Sam Chen", body: "Head of Product" },
    { title: "Jordan Lee", body: "Lead Engineer" },
  ],
  testimonials: [
    { title: "“It changed how we ship.”", body: "— Maria, VP Engineering" },
    { title: "“The onboarding paid for itself in a week.”", body: "— Devin, Operations" },
    { title: "“Our team finally agrees on one tool.”", body: "— Priya, Design Lead" },
  ],
  pricing: [
    { title: "Starter", body: "For individuals getting started. Core features included." },
    { title: "Team", body: "For growing teams that need collaboration and roles." },
    { title: "Enterprise", body: "Advanced security, SSO and dedicated support." },
  ],
  "process-section": [
    { title: "1 · Connect", body: "Bring in your data and tools." },
    { title: "2 · Configure", body: "Tune the workflow to your team." },
    { title: "3 · Ship", body: "Go live with confidence." },
  ],
  "feature-comparison": [
    { title: "Core", body: "Everything you need to start." },
    { title: "Pro", body: "Adds automation and integrations." },
    { title: "Scale", body: "Adds security, SSO and SLAs." },
  ],
  "trust-section": [
    { title: "SOC 2 Type II", body: "Independently audited security." },
    { title: "GDPR", body: "Compliant data handling." },
    { title: "99.9% SLA", body: "Reliability you can plan around." },
  ],
  faq: [
    { title: "How does pricing work?", body: "Simple per-seat pricing, billed monthly or annually." },
    { title: "Can I migrate my data?", body: "Yes — import in minutes with guided tooling." },
    { title: "Is there a free trial?", body: "Every plan starts with a 14-day trial." },
  ],
};

function items(type: string, slots: Record<string, string>, count: number) {
  const fromSlots = slotPairs(slots);
  if (fromSlots.length) return fromSlots;
  const pool = ITEM_COPY[type] ?? ITEM_COPY["feature-grid"];
  return pool.slice(0, Math.max(2, Math.min(pool.length, count || 3)));
}

function ctaText(slots: Record<string, string>, brand?: BrandContext) {
  if (slots.cta) return slots.cta;
  if (slots.button) return slots.button;
  // Reuse a real brand CTA label (skip the design-system "pill-cta" marker).
  const real = brand?.ctaPatterns.find((c) => /[a-z]/i.test(c) && !c.endsWith("-cta") && !/learn more|get started|start building/i.test(c));
  return real ?? "Continue";
}

/**
 * Realistic inline visual artifact for media areas — never empty (requirement).
 * Pure SVG/HTML using brand CSS vars so it stays on-palette. Kind rotates so a
 * page shows variety (dashboard / chart / code / UI panel).
 */
export function mediaArtifact(kind: number, label: string, assetUrl?: string): string {
  // Media rules: prefer a REAL extracted asset; only fall back to a
  // style-matched placeholder when no asset is available.
  if (isUsableAssetUrl(assetUrl)) {
    return `<div class="dna-media dna-media--asset"><img src="${esc(assetUrl)}" alt="${esc(label)}" loading="lazy" class="dna-media__img"></div>`;
  }
  const k = ((kind % 4) + 4) % 4;
  const chrome = `<span class="dna-mock__dots"><i></i><i></i><i></i></span>`;
  let inner = "";
  if (k === 0) {
    // dashboard mockup: sidebar + stat cards + bar chart
    inner = `<div class="dna-mock__bar">${chrome}</div>
      <div class="dna-mock__body">
        <aside class="dna-mock__side"><span></span><span></span><span></span><span></span></aside>
        <div class="dna-mock__main">
          <div class="dna-mock__stats"><div></div><div></div><div></div></div>
          <div class="dna-mock__chart">
            ${[42, 68, 35, 80, 56, 72, 48].map((h) => `<span style="height:${h}%"></span>`).join("")}
          </div>
        </div>
      </div>`;
  } else if (k === 1) {
    // line / area chart
    inner = `<div class="dna-mock__bar">${chrome}<small>Analytics</small></div>
      <div class="dna-mock__chartarea">
        <svg viewBox="0 0 320 160" preserveAspectRatio="none" aria-hidden="true">
          <polyline class="dna-mock__area" points="0,140 40,110 80,120 120,70 160,90 200,40 240,60 280,25 320,45 320,160 0,160"/>
          <polyline class="dna-mock__line" points="0,140 40,110 80,120 120,70 160,90 200,40 240,60 280,25 320,45"/>
        </svg>
      </div>`;
  } else if (k === 2) {
    // code snippet panel
    const lines = [
      [["const", "kw"], [" dna ", "tx"], ["=", "op"], [" extract", "fn"], ["(site)", "tx"]],
      [["return", "kw"], [" tokens", "tx"], [".", "op"], ["map", "fn"], ["(t => t.brand)", "tx"]],
      [["export", "kw"], [" default", "kw"], [" theme", "tx"]],
    ];
    inner = `<div class="dna-mock__bar">${chrome}<small>theme.ts</small></div>
      <pre class="dna-mock__code">${lines
        .map((ln) => `<span class="dna-mock__codeline">${ln.map(([t, c]) => `<em class="t-${c}">${t}</em>`).join("")}</span>`)
        .join("")}</pre>`;
  } else {
    // UI panel: list rows with avatars + status pills
    inner = `<div class="dna-mock__bar">${chrome}<small>Workspace</small></div>
      <div class="dna-mock__list">
        ${[1, 2, 3, 4].map((i) => `<div class="dna-mock__row"><span class="dna-mock__avatar"></span><span class="dna-mock__line2"></span><span class="dna-mock__pill"></span></div>`).join("")}
      </div>`;
  }
  return `<div class="dna-media" data-generated-mock="true" role="img" aria-label="${esc(label)}"><div class="dna-mock">${inner}</div></div>`;
}

/** Instantiate one detected layout. */
function renderSection(
  s: PageArchitecture["sections"][number],
  layout: DesignSystem["layouts"][number] | undefined,
  idx: number,
  brand?: BrandContext,
): string {
  const variant = (s.layout || layout?.variant || "stacked") as DesignSystem["layouts"][number]["variant"];
  const cols = layout?.columns ?? 3;
  const slots = s.contentSlots ?? {};
  const heading = s.heading ? `<h2>${esc(s.heading)}</h2>` : "";
  const sub = s.subheading ? `<p class="dna-section__sub">${esc(s.subheading)}</p>` : "";
  const assetUrl = s.visualAssetUrl;
  const sectionTag = s.type === "footer" ? "footer" : "section";
  const id = s.type === "cta" || s.type === "footer-cta" || s.type === "contact-section" ? ' id="cta"' : "";
  const dataAttr = ` data-layout="${esc(s.type)}" data-variant="${esc(variant)}"`;

  let inner = "";
  switch (variant) {
    case "split": {
      const isHero = idx === 0 || s.type.includes("hero");
      const lead = isHero ? `<h1>${esc(s.heading ?? "")}</h1>` : heading;
      inner = `<div class="dna-split">
        <div class="dna-split__content">
          ${slots.eyebrow ? `<p class="dna-eyebrow">${esc(slots.eyebrow)}</p>` : ""}
          ${lead}
          ${sub}
          <p style="margin-top:1.75rem;"><a class="dna-cta" href="#cta">${esc(ctaText(slots, brand))}</a></p>
        </div>
        ${mediaArtifact(idx, s.heading ?? "Product visual", assetUrl)}
      </div>`;
      break;
    }
    case "grid": {
      let list = items(s.type, slots, layout?.itemCount ?? cols);
      // Prefer the brand's REAL feature names for feature/service grids.
      if (brand && (s.type === "feature-grid" || s.type === "service-grid") && brand.features.length && !slotPairs(slots).length) {
        list = brand.features.slice(0, Math.max(3, Math.min(6, cols))).map((f) => ({ title: f, body: "" }));
      }
      const cards = list
        .map((it) => `<article class="dna-card"><h3>${esc(it.title)}</h3>${it.body ? `<p>${esc(it.body)}</p>` : ""}</article>`)
        .join("\n          ");
      inner = `<div style="text-align:center;">${heading}${sub}</div>
        <div class="${gridClass(Math.max(cols, Math.min(list.length, 4)))}" style="margin-top:2.5rem;">
          ${cards}
        </div>`;
      break;
    }
    case "logos": {
      // Prefer real logo image assets; else brand product names; else labels.
      const logoAssets = (brand?.assets ?? []).filter((a) => a.role === "logo" && isUsableAssetUrl(a.url)).slice(0, 6);
      let logosHtml: string;
      if (logoAssets.length >= 2) {
        logosHtml = logoAssets
          .map((a) => `<span class="dna-logos__item"><img src="${esc(a.url)}" alt="${esc(a.alt || "logo")}" loading="lazy" style="height:28px;width:auto;"></span>`)
          .join("\n          ");
      } else {
        const names = (brand?.products.length ? brand.products : items(s.type, slots, 6).map((l) => l.title)).slice(0, 6);
        const filled = names.length >= 2 ? names : ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark"];
        logosHtml = filled.map((n) => `<span class="dna-logos__item">${esc(n)}</span>`).join("\n          ");
      }
      inner = `<div style="text-align:center;">${heading || `<p class="dna-eyebrow">Trusted by teams worldwide</p>`}</div>
        <div class="dna-logos" style="margin-top:2rem;">
          ${logosHtml}
        </div>`;
      break;
    }
    case "form": {
      inner = `<div style="max-width:640px;margin-inline:auto;">
        ${heading}${sub}
        <form class="dna-card" style="display:grid;gap:1rem;margin-top:2rem;">
          <label>Name<input class="dna-input" name="name" required style="margin-top:.35rem;"></label>
          <label>Email<input class="dna-input" type="email" name="email" required style="margin-top:.35rem;"></label>
          <label>Message<textarea class="dna-input" name="message" rows="4" style="margin-top:.35rem;"></textarea></label>
          <button class="dna-button" type="submit">${esc(ctaText(slots, brand))}</button>
        </form>
      </div>`;
      break;
    }
    case "media": {
      inner = `<div style="text-align:center;">${heading}${sub}</div>
        <div style="margin-top:2rem;">${mediaArtifact(idx, s.heading ?? "Visual", assetUrl)}</div>`;
      break;
    }
    case "centered": {
      const isHero = idx === 0 || s.type === "hero";
      const lead = isHero ? `<h1>${esc(s.heading ?? "Welcome")}</h1>` : `<h2>${esc(s.heading ?? "Ready to start?")}</h2>`;
      inner = `<div style="text-align:center;max-width:760px;margin-inline:auto;">
        ${slots.eyebrow ? `<p class="dna-eyebrow">${esc(slots.eyebrow)}</p>` : ""}
        ${lead}
        ${sub}
        <p style="margin-top:1.75rem;"><a class="dna-cta" href="#cta">${esc(ctaText(slots, brand))}</a></p>
      </div>`;
      break;
    }
    default: {
      // stacked / content-block — real detected layout, prose composition.
      if (s.type === "footer") {
        return `  <footer class="dna-section"${dataAttr} style="border-top:1px solid var(--color-border,rgba(0,0,0,.1));">
    <div class="dna-container">${heading || `<p>&copy; ${new Date().getFullYear()}. All rights reserved.</p>`}</div>
  </footer>`;
      }
      const body = slotPairs(slots);
      const prose = body.length
        ? body.map((p) => `<p>${esc(p.body || p.title)}</p>`).join("\n        ")
        : `<p>${esc(s.subheading || s.heading || "")}</p>`;
      inner = `<div style="max-width:${"72ch"};">${heading}${prose}</div>`;
    }
  }

  return `  <${sectionTag} class="dna-section"${id}${dataAttr}>
    <div class="dna-container">
      ${inner}
    </div>
  </${sectionTag}>`;
}

export function renderHtml(arch: PageArchitecture, system: DesignSystem, dna: DesignDna, css: string, brand?: BrandContext): string {
  const layoutByType = new Map(system.layouts.map((l) => [l.type, l]));
  const body = arch.sections.map((s, i) => renderSection(s, layoutByType.get(s.type), i, brand)).join("\n");
  const fontLinks = googleFontLinks(dna);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(arch.pageTitle)}</title>
  <meta name="description" content="${esc(arch.metaDescription)}">
  <meta property="og:title" content="${esc(arch.pageTitle)}">
  <meta property="og:description" content="${esc(arch.metaDescription)}">
${fontLinks}
  <style>
${css}
  .dna-section__sub { font-size: 1.125rem; opacity: .8; max-width: 60ch; }
  .dna-section[data-variant="centered"] .dna-section__sub,
  .dna-section[data-variant="grid"] .dna-section__sub { margin-inline: auto; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function googleFontLinks(dna: DesignDna): string {
  const families = dna.typography.fonts
    .filter((f) => f.source !== "system" && !/system|-apple|sans-serif|serif|mono$/i.test(f.family))
    .map((f) => f.family.replace(/\s+/g, "+"));
  if (!families.length) return "";
  const spec = families.map((f) => `family=${f}:wght@400;500;600;700`).join("&");
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${spec}&display=swap" rel="stylesheet">`;
}
