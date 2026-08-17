// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public entity feeds (MASTER.md §5, C2.21, §4.2 merchandising).
//
// Product, location, event and newsletter feeds are projections of the same
// registry the sitemap reads. A feed that listed a URL the sitemap did not
// — or the other way around — is two records of one fact, and they drift.
// Empty kinds still render a valid feed: the endpoint exists so later
// modules register into it rather than invent a second URL.

import { absoluteUrl } from "@/core/seo/meta";
import type { PublicEntity, PublicEntityKind } from "@/core/seo/entities";
import { entitiesOfKind } from "@/core/seo/entities";

export const FEED_KINDS = [
  "products",
  "locations",
  "events",
  "newsletters",
] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

const KIND_FOR_FEED: Record<FeedKind, PublicEntityKind> = {
  products: "product",
  locations: "location",
  events: "event",
  newsletters: "newsletter",
};

export function isFeedKind(value: string): value is FeedKind {
  return (FEED_KINDS as readonly string[]).includes(value);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

export function renderEntityFeed(input: {
  origin: string;
  kind: FeedKind;
  title: string;
  entities: PublicEntity[];
}): string {
  const members = entitiesOfKind(input.entities, KIND_FOR_FEED[input.kind]);
  const self = `${input.origin}/feeds/${input.kind}.xml`;
  const updated = members.reduce<Date | undefined>((latest, entity) => {
    if (!entity.updatedAt) return latest;
    if (!latest || entity.updatedAt > latest) return entity.updatedAt;
    return latest;
  }, undefined);

  const entries = members
    .map((entity) => {
      const loc = escapeXml(absoluteUrl(input.origin, entity.slug));
      const title = escapeXml(entity.title ?? entity.slug);
      const updatedAt = (entity.updatedAt ?? new Date()).toISOString();
      const summary = entity.description
        ? `<summary>${escapeXml(entity.description)}</summary>`
        : "";
      return `<entry><id>${loc}</id><title>${title}</title><updated>${updatedAt}</updated><link href="${loc}"/>${summary}</entry>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<feed xmlns="http://www.w3.org/2005/Atom">` +
    `<title>${escapeXml(input.title)}</title>` +
    `<id>${escapeXml(self)}</id>` +
    `<updated>${(updated ?? new Date(0)).toISOString()}</updated>` +
    `<link href="${escapeXml(self)}" rel="self"/>` +
    entries +
    `</feed>`
  );
}
