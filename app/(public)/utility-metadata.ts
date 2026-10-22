// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Metadata for the platform's own public routes (MASTER.md §5).
//
// CMS pages get their title, description and canonical from the page row.
// Routes the platform renders itself — /book, /memberships — had only a bare
// title: no brand, no description, no canonical, so every site's booking
// page shared one snippet-less title in search results. This gives them the
// same composition the CMS uses, from the business profile.
import type { Metadata } from "next";
import { localePath } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { composeDescription, composeDocumentTitle, ogImagePath } from "@/core/seo/meta";
import { siteOrigin } from "@/core/seo/origin";

export async function utilityPageMetadata(input: {
  /** Path without a leading slash, e.g. "book". */
  path: string;
  title: string;
  description: string;
  /** Utility pages that answer per-visitor state (booking) stay out of the index. */
  index: boolean;
}): Promise<Metadata> {
  const business = await currentBusiness();
  const origin = siteOrigin();
  const defaultLocale = business?.defaultLocale ?? "en";
  const title = composeDocumentTitle(input.title, business?.name, false);
  const description = composeDescription(input.description);
  const canonical = `${origin}${localePath(input.path, defaultLocale, defaultLocale)}`;
  return {
    title,
    description,
    robots: input.index ? undefined : { index: false, follow: true },
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: business?.name ?? undefined,
      images: [{ url: `${origin}${ogImagePath(input.path)}`, width: 1200, height: 630, alt: title }],
    },
  };
}
