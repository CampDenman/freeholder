// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-page SEO fields (MASTER.md §5).
//
// Titles and descriptions are unique *and* short. An owner-supplied override
// already has a 60/155 character ceiling in the write schema; the renderer
// still has to keep the composed title (page · site) inside that budget, or
// the search snippet is whatever the engine truncated — usually the unique
// half of the title.
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
): string {
  const own = clipSeoText(title, TITLE_LIMIT);
  if (isHome || !siteName || own === siteName) return own;
  const combined = `${own} · ${siteName}`;
  return combined.length <= TITLE_LIMIT ? combined : own;
}

export function composeDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  return clipSeoText(description, DESCRIPTION_LIMIT);
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
