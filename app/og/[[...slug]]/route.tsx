// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Auto-generated Open Graph image (MASTER.md §5).
//
// One branded card per public page. An owner-supplied `seo.ogImage` wins in
// the page metadata and never reaches this route.
import { ogImageResponse } from "../og-template";
import { siteOrigin } from "@/core/seo/origin";
import { currentBusiness } from "@/core/settings/read";
import { publishedPage } from "@/modules/cms/read";
import { getLocale } from "../../i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { slug?: string[] };

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
): Promise<Response> {
  const { slug } = await params;
  const path = (slug ?? []).join("/");
  const locale = await getLocale();
  const [page, business] = await Promise.all([
    publishedPage(path, locale),
    currentBusiness(),
  ]);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const seo = (page.seo ?? {}) as { title?: string; ogImage?: string };
  if (seo.ogImage) {
    return Response.redirect(new URL(seo.ogImage, siteOrigin()).toString(), 302);
  }

  return ogImageResponse({
    title: seo.title ?? page.title,
    siteName: business?.name ?? page.title,
    tagline: page.slug === "" ? business?.tagline : null,
  });
}
