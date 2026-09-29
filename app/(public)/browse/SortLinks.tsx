// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront sort control (C3.25 slice 2).
//
// Links, not a dropdown: each ordering is its own crawlable URL and the
// active one announces itself with aria-current. The page owns the query
// state and the href builder; this component only renders.

import type { BrowseSortOrder } from "@/modules/catalog/contract";
import type { BrowseQuery } from "../browse-params";
import { setSort } from "../browse-params";

export interface SortLinksLabels {
  nav: string;
  featured: string;
  priceAsc: string;
  priceDesc: string;
  newest: string;
  title: string;
}

const SORTS: { sort: BrowseSortOrder; label: (labels: SortLinksLabels) => string }[] = [
  { sort: "featured", label: (labels) => labels.featured },
  { sort: "price-asc", label: (labels) => labels.priceAsc },
  { sort: "price-desc", label: (labels) => labels.priceDesc },
  { sort: "newest", label: (labels) => labels.newest },
  { sort: "title", label: (labels) => labels.title },
];

export function SortLinks({
  query,
  hrefFor,
  labels,
}: {
  query: BrowseQuery;
  hrefFor: (query: BrowseQuery) => string;
  labels: SortLinksLabels;
}) {
  const current = query.sort ?? "featured";
  return (
    <nav aria-label={labels.nav} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-muted">{labels.nav}</span>
      <ul className="flex flex-wrap list-none gap-2 p-0">
        {SORTS.map(({ sort, label }) => (
          <li key={sort}>
            <a
              href={hrefFor(setSort(query, sort))}
              aria-current={sort === current || undefined}
              className="rounded-md border border-rule px-3 py-1.5 text-ink hover:text-accent aria-current:border-accent aria-current:text-accent"
            >
              {label(labels)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
