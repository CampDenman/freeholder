// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-page SEO fields (MASTER.md §5).
//
// Newly composed titles and descriptions use 60/155-character suggestions.
// Imported originals carry an explicit preservation flag: migration must not
// silently change a publisher’s existing search title or description.
//
// Filter query strings are a different page to a crawler and the same page
// to a visitor. They are noindexed and canonicalised to the clean path so
// they never mint the near-duplicates RIBA exists to prevent.

export const TITLE_LIMIT = 60;
export const DESCRIPTION_LIMIT = 155;

/** Query keys that describe a filtered or sorted view of another URL. */
export const FILTER_QUERY_KEYS = new Set([
  "filter",
  "filters",
  "sort",
  "q",
  "query",
  "color",
  "size",
  "min",
  "max",
  "page",
  "commentPage",
  "facet",
]);

export function clipSeoText(value: string, limit: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= limit) return trimmed;
  const budget = Math.max(1, limit - 1);
  const sliced = trimmed.slice(0, budget);
  const atWord = sliced.replace(/\s+\S*$/, "").replace(/[,:;–—-]\s*$/, "");
  const base = atWord.length >= Math.floor(budget / 2) ? atWord : sliced.trimEnd();
  return `${base}…`;
}

/**
 * The document title a crawler (and a tab) should see.
 *
 * The home page is the business; every other page keeps its own name and
 * only appends the site when the pair still fits in 60 characters. Appending
 * past the budget is how two pages that were unique in the database become
 * identical in the SERP.
 */
export function composeDocumentTitle(
  title: string,
  siteName: string | undefined,
  isHome: boolean,
  preserve = false,
): string {
  // Imported search titles already carry the publisher's deliberate wording.
  // Keep them byte-for-byte instead of silently clipping or appending a brand.
  if (preserve) return title;
  const own = clipSeoText(title, TITLE_LIMIT);
  // A title that already names the business ("About Aurora Coast
  // Photography") would otherwise come out doubled: "About Aurora Coast
  // Photography · Aurora Coast Photography".
  if (isHome || !siteName || namesBrand(own, siteName)) return own;
  const combined = `${own} · ${siteName}`;
  return combined.length <= TITLE_LIMIT ? combined : own;
}

/**
 * Whether a title already carries the brand as a whole phrase at its start or
 * end ("About Aurora Coast Photography", "Aurora Coast Photography: FAQ").
 * Whole words only, so a short brand ("Art") does not swallow "Artists" or a
 * title that merely mentions it mid-sentence.
 */
function namesBrand(title: string, brand: string): boolean {
  const name = brand.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const edge = "[\\s·|:—–-]";
  return new RegExp(`^(?:${escaped})(?:$|${edge})|(?:^|${edge})(?:${escaped})$`, "iu").test(title.trim());
}

export function composeDescription(description: string | undefined, preserve = false): string | undefined {
  if (!description) return undefined;
  return preserve ? description : clipSeoText(description, DESCRIPTION_LIMIT);
}

export function isFilterQuery(
  query: Record<string, string | string[] | undefined>,
): boolean {
  return Object.keys(query).some((key) => {
    const lower = key.toLowerCase();
    return FILTER_QUERY_KEYS.has(lower) || lower.startsWith("filter[");
  });
}

/** `/og` for home, `/og/services/weddings` for a nested page. */
export function ogImagePath(pagePath: string): string {
  const clean = pagePath.replace(/^\/+|\/+$/g, "");
  return clean === "" ? "/og" : `/og/${clean}`;
}

export function absoluteUrl(origin: string, slug: string): string {
  return slug === "" ? `${origin}/` : `${origin}/${slug.replace(/^\/+/, "")}`;
}
