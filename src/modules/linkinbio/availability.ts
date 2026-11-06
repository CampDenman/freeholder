// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whether a smart link's destination is still there (C9.39).
//
// One function used by two callers that must agree: the block, deciding what
// a visitor sees, and `linkinbio.page`, telling the owner *why* an entry is
// missing from the page. They reach the other modules differently — the block
// renders outside any transaction, the service inside one — so the caller
// hands in how to call a service by name. Asking by name rather than by import
// is also what keeps this module working with catalog or galleries switched
// off: an absent service answers "not available", never an error.
import { linkState, pageDependency, type LinkItem } from "./links";

export type CallByName = (name: string, input: Record<string, unknown>) => Promise<unknown>;

async function ask<T>(call: CallByName, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    return (await call(name, input)) as T;
  } catch {
    return null;
  }
}

/** The entries a visitor sees now, each one checked against what it points at. */
export async function availableLinks(
  links: LinkItem[],
  timezone: string,
  call: CallByName,
  now = new Date(),
): Promise<{ shown: LinkItem[]; unavailable: Set<string> }> {
  const live = links.filter((link) => linkState(link, now, timezone) === "live");
  const unavailable = new Set<string>();

  const pages = [
    ...new Set(
      live
        .map((link) => pageDependency(link.kind, link.target))
        .filter((slug): slug is string => slug !== null),
    ),
  ];
  const published = new Set(
    pages.length > 0
      ? ((await ask<{ slugs: string[] }>(call, "cms.livePaths", { slugs: pages }))?.slugs ?? [])
      : [],
  );

  const bookable = new Set<string>();
  if (live.some((link) => link.kind === "booking")) {
    const listed = await ask<{ services: Array<{ productId: string }> }>(
      call,
      "catalog.bookableServices",
      {},
    );
    for (const service of listed?.services ?? []) bookable.add(service.productId.toLowerCase());
  }

  for (const link of live) {
    const dependency = pageDependency(link.kind, link.target);
    if (dependency !== null && !published.has(dependency)) unavailable.add(link.id);
    if (link.kind === "booking" && !bookable.has(link.target.trim().toLowerCase())) {
      unavailable.add(link.id);
    }
    if (link.kind === "gallery") {
      const found = await ask<{ expired: boolean } | null>(call, "galleries.publicBySlug", {
        slug: link.target.trim().replace(/^\/?g\//, ""),
      });
      if (!found || found.expired) unavailable.add(link.id);
    }
  }
  return { shown: live.filter((link) => !unavailable.has(link.id)), unavailable };
}
