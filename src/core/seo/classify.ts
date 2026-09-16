// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Classify a public path under RIBA (MASTER.md §5).
//
// Kept as a leaf so the CMS sitemap source can stamp kind/priority without
// importing the sitemap engine (which loads every module manifest).

export const PUBLIC_ENTITY_KINDS = [
  "page",
  "section",
  "product",
  "location",
  "event",
  "newsletter",
  "article",
  "service",
  "project",
  "collection",
] as const;

export type PublicEntityKind = (typeof PUBLIC_ENTITY_KINDS)[number];

const SECTION_INDEXES = new Set([
  "services",
  "shop",
  "products",
  "portfolio",
  "blog",
  "journal",
  "locations",
  "events",
  "newsletters",
]);

export function kindFromSlug(slug: string): PublicEntityKind {
  if (slug === "") return "page";
  const segments = slug.split("/").filter(Boolean);
  const [root, leaf] = segments;
  if (segments.length === 1 && root && SECTION_INDEXES.has(root)) return "section";
  if (root === "locations" && leaf) return "location";
  if ((root === "shop" || root === "products") && leaf) return "product";
  if (root === "events" && leaf) return "event";
  if (root === "newsletters" && leaf) return "newsletter";
  if ((root === "blog" || root === "journal") && leaf) return "article";
  if (root === "services" && leaf) return "service";
  if (root === "portfolio" && leaf) {
    return leaf.startsWith("collections-") ? "collection" : "project";
  }
  return segments.length === 1 ? "section" : "page";
}

export function priorityFromSlug(slug: string): number {
  if (slug === "") return 1;
  return kindFromSlug(slug) === "section" ? 0.8 : 0.5;
}
