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
import { targetFor } from "@/modules/share/service";
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

  // §34: the share target is where an entity's *social* face is written down,
  // and it outranks the SEO title here for the same reason it does in the page
  // metadata — the card is read by somebody who was not already looking.
  const share = await targetFor
    .call({ path: page.slug, locale }, { kind: "anonymous" })
    .catch(() => null);

  const supplied = share?.imageUrl ?? seo.ogImage;
  if (supplied) {
    return Response.redirect(new URL(supplied, siteOrigin()).toString(), 302);
  }

  return ogImageResponse({
    title: share?.socialTitle ?? seo.title ?? page.title,
    siteName: business?.name ?? page.title,
    tagline: page.slug === "" ? business?.tagline : null,
  });
}
