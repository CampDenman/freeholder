// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// One locale's sitemap, assembled from every module that declared a source in
// its manifest (§5, §11). Nothing here knows what a page or a gallery is.
//
// Reached as `/sitemap-en.xml` — the address the index and robots.txt publish,
// and the one crawlers expect. A dynamic *part* of a segment is not a route
// Next will match, so the pretty name is rewritten onto this one in `proxy.ts`.
import { collectSitemapEntries, renderSitemap } from "@/core/seo/sitemap";
import { originFor } from "@/core/seo/origin";
import { getBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  // The sources are looked up in the service registry by name, so the platform
  // has to be wired before this can answer.
  await ready();

  const { locale } = await params;
  const business = await getBusiness.call({}, ANONYMOUS);

  // A sitemap for a language this business does not publish would be a copy of
  // the default one under a URL that implies a translation exists.
  if (!business?.enabledLocales.includes(locale)) {
    return new Response("Not found", { status: 404 });
  }

  const entries = await collectSitemapEntries(locale);
  return new Response(renderSitemap(originFor(request), entries), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
