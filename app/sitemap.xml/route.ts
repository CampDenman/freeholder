// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The sitemap index (MASTER.md §5: "locale-split sitemaps under a sitemap
// index"). One entry per enabled locale; a single-locale site gets an index of
// one, so adding a language later changes nothing a crawler already knows.
import { getBusiness } from "@/core/settings/service";
import { collectSitemapEntries, localeSitemapHrefs, renderSitemapIndexFromHrefs } from "@/core/seo/sitemap";
import { originFor } from "@/core/seo/origin";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(request: Request): Promise<Response> {
  await ready();
  const business = await getBusiness.call({}, ANONYMOUS);
  const locales = business?.enabledLocales ?? ["en"];
  const origin = originFor(request);
  const hrefs: string[] = [];
  for (const locale of locales) {
    const entries = await collectSitemapEntries(locale);
    hrefs.push(...localeSitemapHrefs(origin, locale, entries.length));
  }
  return new Response(renderSitemapIndexFromHrefs(hrefs), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
