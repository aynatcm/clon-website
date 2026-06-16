import type { DesignDna } from "@/lib/dna/schema";
import type { DesignSystem } from "@/lib/designsystem/schema";
import type { BrandContext } from "@/lib/brand/schema";
import { isUsableAssetUrl } from "@/lib/brand/assets";
import { esc, mediaArtifact } from "@/lib/generation/render";
import type { SectionRecipe, SlotValues } from "./schema";

/**
 * Recipe instantiation renderer. The HTML structure is produced ENTIRELY from
 * the recipe (variant, columns, media placement, card structure, cta count,
 * spacing, alignment). Slot values are dropped into fixed positions — they
 * cannot change the layout.
 */

const gridClass = (cols: number) => `dna-grid dna-grid--${Math.max(2, Math.min(6, cols || 3))}`;
const asArr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const splitCard = (s: string): { title: string; body: string } => {
  const [t, ...b] = s.split("::");
  return { title: (t ?? "").trim(), body: b.join("::").trim() };
};
const brandCta = (brand: BrandContext | undefined) =>
  brand?.ctaPatterns.find((c) => /[a-z]/i.test(c) && !c.endsWith("-cta") && !/learn more|get started|start building|open app/i.test(c)) ??
  brand?.navigationPatterns.find((c) => /\b(contacto|contact)\b/i.test(c)) ??
  brand?.navigationPatterns.find((c) => /\b(servicios|services|proyectos|projects|leer|más|mas)\b/i.test(c)) ??
  "Contact";

const isSpanishBrand = (brand: BrandContext | undefined) =>
  [...(brand?.headlines ?? []), ...(brand?.navigationPatterns ?? []), ...(brand?.features ?? [])].some((s) =>
    /[¿¡áéíóúñ]|\b(contacto|servicios|proyectos|acerca|trabajar|contáctenos)\b/i.test(s),
  );

export function renderRecipeSection(
  recipe: SectionRecipe,
  values: SlotValues,
  system: DesignSystem,
  brand: BrandContext | undefined,
  idx: number,
  assetUrl?: string,
): string {
  const val = (id: string) => (typeof values[id] === "string" ? (values[id] as string) : "");
  const valByKind = (kind: string) => {
    const slot = recipe.slots.find((s) => s.kind === kind);
    return slot ? val(slot.id) : "";
  };
  const headingSlot = recipe.slots.find((s) => s.kind === "heading");
  const hTag = headingSlot?.level === 1 && idx === 0 ? "h1" : "h2";
  const eyebrow = valByKind("eyebrow");
  const heading = recipe.slots.find((s) => s.kind === "heading") ? val(headingSlot!.id) : "";
  const sub = valByKind("subheading");
  const ctaSlots = recipe.slots.filter((s) => s.kind === "cta");
  const tag = recipe.type === "footer" ? "footer" : "section";
  const anchor = recipe.type === "cta" || recipe.type === "footer-cta" || recipe.type === "contact-section" ? ' id="cta"' : "";
  const padStyle = `style="padding-block:${esc(recipe.spacing.top)} ${esc(recipe.spacing.bottom)};"`;
  const data = ` data-recipe="${esc(recipe.type)}" data-variant="${esc(recipe.variant)}"`;

  const headBlock = (centered: boolean) =>
    `${eyebrow ? `<p class="dna-eyebrow">${esc(eyebrow)}</p>` : ""}` +
    `${heading ? `<${hTag}>${esc(heading)}</${hTag}>` : ""}` +
    `${sub ? `<p class="dna-section__sub"${centered ? ' style="margin-inline:auto;"' : ""}>${esc(sub)}</p>` : ""}`;

  const fallbackCta = brandCta(brand);
  const ctaButtons = ctaSlots
    .map((s, i) => `<a class="${i === 0 ? "dna-cta" : "dna-button dna-button--secondary"}" href="#cta">${esc(val(s.id) || fallbackCta)}</a>`)
    .join(" ");

  let inner = "";
  switch (recipe.variant) {
    case "split": {
      const content = `<div class="dna-split__content">${headBlock(false)}${ctaButtons ? `<p style="margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap;">${ctaButtons}</p>` : ""}</div>`;
      const media = mediaArtifact(idx, heading || "Product visual", assetUrl);
      inner = `<div class="dna-split">${recipe.mediaPlacement === "left" ? media + content : content + media}</div>`;
      break;
    }
    case "media": {
      const media = mediaArtifact(idx, heading || "Product visual", assetUrl);
      inner = `<div class="dna-media-stack">
        <div class="dna-media-stack__content">${headBlock(false)}${ctaButtons ? `<p style="margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap;">${ctaButtons}</p>` : ""}</div>
        ${media}
      </div>`;
      break;
    }
    case "grid": {
      const cards = asArr(values.cards ?? values.stats)
        .map((c) => {
          const { title, body } = splitCard(c);
          const icon = recipe.card?.hasIcon ? `<span class="dna-cardicon" aria-hidden="true"></span>` : "";
          const cta = recipe.card?.hasCta ? `<a class="dna-button dna-button--secondary" href="#cta" style="margin-top:.75rem;">${esc(brandCta(brand))}</a>` : "";
          return `<article class="dna-card">${icon}<h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}${cta}</article>`;
        })
        .join("\n        ");
      inner = `<div style="text-align:center;">${headBlock(true)}</div>
      <div class="${gridClass(recipe.columns)}" style="margin-top:2.5rem;">
        ${cards}
      </div>`;
      break;
    }
    case "logos": {
      const logoAssets = (brand?.assets ?? []).filter((a) => a.role === "logo" && isUsableAssetUrl(a.url)).slice(0, recipe.slots.find((s) => s.kind === "logoGroup")?.count ?? 6);
      const html =
        logoAssets.length >= 2
          ? logoAssets.map((a) => `<span class="dna-logos__item"><img src="${esc(a.url)}" alt="${esc(a.alt || "logo")}" loading="lazy" style="height:28px;width:auto;"></span>`).join("\n        ")
          : asArr(values.logos).map((n) => `<span class="dna-logos__item">${esc(n)}</span>`).join("\n        ");
      inner = `<div style="text-align:center;">${headBlock(true)}</div><div class="dna-logos" style="margin-top:2rem;">${html}</div>`;
      break;
    }
    case "form": {
      const es = isSpanishBrand(brand);
      const labels = es
        ? { name: "Nombre", email: "Correo", message: "Mensaje", submit: val("form") || brandCta(brand) }
        : { name: "Name", email: "Email", message: "Message", submit: val("form") || "Send message" };
      inner = `<div style="max-width:640px;margin-inline:auto;">${headBlock(true)}
      <form class="dna-card" style="display:grid;gap:1rem;margin-top:2rem;">
        <label>${esc(labels.name)}<input class="dna-input" name="name" required style="margin-top:.35rem;"></label>
        <label>${esc(labels.email)}<input class="dna-input" type="email" name="email" required style="margin-top:.35rem;"></label>
        <label>${esc(labels.message)}<textarea class="dna-input" name="message" rows="4" style="margin-top:.35rem;"></textarea></label>
        <button class="dna-button" type="submit">${esc(labels.submit)}</button>
      </form></div>`;
      break;
    }
    case "centered": {
      inner = `<div style="text-align:center;max-width:760px;margin-inline:auto;">${headBlock(true)}${ctaButtons ? `<p style="margin-top:1.75rem;">${ctaButtons}</p>` : ""}</div>`;
      break;
    }
    case "stacked": {
      const hasMedia = recipe.mediaPlacement !== "none" && recipe.type !== "footer";
      const media = hasMedia ? mediaArtifact(idx, heading || "Section visual", assetUrl) : "";
      const ctas = ctaButtons ? `<p style="margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap;">${ctaButtons}</p>` : "";
      if (hasMedia && (recipe.mediaPlacement === "left" || recipe.mediaPlacement === "right")) {
        const content = `<div class="dna-split__content">${headBlock(false)}${ctas}</div>`;
        inner = `<div class="dna-split">${recipe.mediaPlacement === "left" ? media + content : content + media}</div>`;
      } else {
        inner = `<div class="dna-media-stack">
          <div class="dna-media-stack__content">${headBlock(false)}${ctas}</div>
          ${media}
        </div>`;
      }
      break;
    }
    default: {
      if (recipe.type === "footer") {
        return `  <footer class="dna-section"${data} style="border-top:1px solid var(--color-border,rgba(0,0,0,.1));">
    <div class="dna-container">${heading ? `<${hTag}>${esc(heading)}</${hTag}>` : `<p>&copy; ${new Date().getFullYear()}. All rights reserved.</p>`}</div>
  </footer>`;
      }
      inner = `<div style="max-width:72ch;">${headBlock(false)}</div>`;
    }
  }

  return `  <${tag} class="dna-section"${anchor}${data} ${padStyle}>
    <div class="dna-container"${recipe.alignment === "center" ? ' style="text-align:center;"' : ""}>
      ${inner}
    </div>
  </${tag}>`;
}
