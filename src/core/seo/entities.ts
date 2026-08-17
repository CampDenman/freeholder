// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public entity registry (MASTER.md §5, C2.21).
//
// Sitemap sources, OG images, IndexNow pings and product/location/event/
// newsletter feeds all have to describe the *same* set of URLs. A second
// list — a hand-maintained feed, a hard-coded OG route — is how a page
// disappears from one surface and not the others. Modules already declare
// `seo.sitemapSources`; this file is the typed view over that list.

import { collectSitemapEntries, type SitemapEntry } from "@/core/seo/sitemap";
import {
  kindFromSlug,
  priorityFromSlug,
  type PublicEntityKind,
} from "@/core/seo/classify";

export {
  kindFromSlug,
  priorityFromSlug,
  PUBLIC_ENTITY_KINDS,
  type PublicEntityKind,
} from "@/core/seo/classify";

export interface PublicEntity {
  kind: PublicEntityKind;
  slug: string;
  title?: string;
  description?: string;
  updatedAt?: Date;
  imageUrl?: string | null;
  /** 0–1. Browse/section pages outrank leaves (RIBA §3.2). */
  priority: number;
  locale: string;
}

export function toPublicEntity(entry: SitemapEntry, locale: string): PublicEntity {
  const kind = entry.kind ?? kindFromSlug(entry.slug);
  return {
    kind,
    slug: entry.slug,
    title: entry.title,
    description: entry.description,
    updatedAt: entry.updatedAt,
    imageUrl: entry.imageUrl,
    priority: entry.priority ?? priorityFromSlug(entry.slug),
    locale,
  };
}

export async function collectPublicEntities(locale: string): Promise<PublicEntity[]> {
  const entries = await collectSitemapEntries(locale);
  return entries.map((entry) => toPublicEntity(entry, locale));
}

export function entitiesOfKind(
  entities: PublicEntity[],
  kind: PublicEntityKind,
): PublicEntity[] {
  return entities.filter((entity) => entity.kind === kind);
}
