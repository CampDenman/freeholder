// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// llms.txt (MASTER.md §5, AEO).
//
// "Auto-generated /llms.txt describing the business, offerings, locations, and
// key pages." Generated rather than authored for the same reason the sitemap
// is: a file an owner has to remember to update is a file that is wrong within
// a month. It is assembled from what the site already knows — the business
// profile and whatever every module put in the sitemap.
//
// Deliberately plain. An answer engine reading this wants the shape of the
// business and where to look, not marketing copy it will have to strip.
import { getBusiness } from "@/core/settings/service";
import { collectSitemapEntries } from "@/core/seo/sitemap";
import { originFor } from "@/core/seo/origin";
import { humanizeSegment } from "@/core/seo/jsonld";
import { ready } from "@/core/runtime";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function GET(request: Request): Promise<Response> {
  await ready();
  const origin = originFor(request);
  const business = await getBusiness.call({}, ANONYMOUS);

  if (!business) {
    return new Response("# This instance has not been set up yet.\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Listed from what is actually published, home included — a link to a home
  // page nobody has written yet is exactly the kind of confident wrongness an
  // answer engine will repeat.
  const entries = await collectSitemapEntries(business.defaultLocale);
  const pages = entries.map((entry) =>
    entry.slug === ""
      ? `- [Home](${origin}/)`
      : `- [${humanizeSegment(entry.slug.split("/").pop() ?? entry.slug)}](${origin}/${entry.slug})`,
  );

  const lines = [
    `# ${business.name}`,
    "",
    business.tagline ?? "",
    "",
    `> ${business.name} is a ${business.schemaType} based in ${business.country}, `
      + `publishing in ${business.enabledLocales.join(", ")} and charging in ${business.baseCurrency}.`,
    "",
    "## Pages",
    "",
    ...(pages.length > 0 ? pages : ["_Nothing published yet._"]),
    "",
    "## Notes",
    "",
    `- Times on this site are shown in ${business.timezone}.`,
    `- Sitemap: ${origin}/sitemap.xml`,
    "",
  ];

  return new Response(lines.filter((line) => line !== undefined).join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
