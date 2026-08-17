// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product / location / event / newsletter feeds (MASTER.md §5, C2.21).
//
// The pretty address is `/feeds/products.xml`; the rewrite lives in proxy.ts
// for the same reason the locale sitemaps do.
import { collectPublicEntities } from "@/core/seo/entities";
import { isFeedKind, renderEntityFeed } from "@/core/seo/feeds";
import { originFor } from "@/core/seo/origin";
import { getBusiness } from "@/core/settings/service";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<Response> {
  await ready();
  const { kind } = await params;
  if (!isFeedKind(kind)) {
    return new Response("Not found", { status: 404 });
  }

  const origin = originFor(request);
  const business = await getBusiness.call({}, ANONYMOUS);
  const locale = business?.defaultLocale ?? "en";
  const entities = await collectPublicEntities(locale);
  const title = `${business?.name ?? "Site"} ${kind}`;

  return new Response(renderEntityFeed({ origin, kind, title, entities }), {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
