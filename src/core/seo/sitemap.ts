// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The sitemap engine (MASTER.md §5, §11).
//
// This is what `seo: { sitemapSources: [...] }` in a module manifest has been
// declaring since cms shipped. A module names a *service*, not a list, because
// the list changes every time an owner publishes — and the engine calls it
// without knowing what a page, a product or a gallery is. A module that ships
// public content ships its sitemap entry by existing (§8: "build in core
// routing, not as a plugin — every module's public pages inherit it for free").
import manifests from "@/modules";
import { getService } from "@/core/service";

export interface SitemapEntry {
  /** Path with no leading slash; "" is the home page. */
  slug: string;
  updatedAt?: Date;
}

/**
 * Every public URL this instance serves, from every enabled module.
 *
 * A source that fails is skipped with a warning rather than taking the sitemap
 * down: a broken module should cost its own pages, not every other module's.
 */
export async function collectSitemapEntries(
  locale: string,
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];

  for (const manifest of manifests) {
    for (const serviceName of manifest.seo?.sitemapSources ?? []) {
      try {
        const service = getService(serviceName);
        const rows = (await service.call({ locale }, { kind: "system" })) as
          | SitemapEntry[]
          | undefined;
        if (Array.isArray(rows)) entries.push(...rows);
      } catch (error) {
        console.warn(
          `[seo] sitemap source "${serviceName}" from module "${manifest.name}" failed`,
          error,
        );
      }
    }
  }

  // Deduplicated because two modules could legitimately claim one path, and a
  // sitemap listing the same URL twice is a defect a crawler will report.
  const bySlug = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    const existing = bySlug.get(entry.slug);
    if (!existing || (entry.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      bySlug.set(entry.slug, entry);
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

export function renderSitemap(
  origin: string,
  entries: SitemapEntry[],
): string {
  const urls = entries
    .map((entry) => {
      const loc = escapeXml(entry.slug === "" ? `${origin}/` : `${origin}/${entry.slug}`);
      const lastmod = entry.updatedAt
        ? `<lastmod>${entry.updatedAt.toISOString().slice(0, 10)}</lastmod>`
        : "";
      return `<url><loc>${loc}</loc>${lastmod}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

/**
 * One sitemap per locale under an index (§5).
 *
 * An index for a single-locale site looks like ceremony, and it is not: adding
 * a second language later then changes nothing a crawler has already fetched,
 * because the address it knows keeps working and simply lists more.
 */
export function renderSitemapIndex(origin: string, locales: string[]): string {
  const maps = locales
    .map(
      (locale) =>
        `<sitemap><loc>${escapeXml(`${origin}/sitemap-${locale}.xml`)}</loc></sitemap>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps}</sitemapindex>`;
}

/**
 * robots.txt (§5).
 *
 * Admin and portal are blocked because they are an owner's private surfaces,
 * not because they are secret — they are behind auth as well. `/preview` joins
 * them: it renders unpublished drafts, and a crawler following a leaked link
 * should not index a page nobody published.
 */
export function renderRobots(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /login",
    "Disallow: /preview",
    "Disallow: /portal",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
