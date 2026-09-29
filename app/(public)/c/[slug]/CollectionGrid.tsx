// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The collection storefront grid (C3.25 slice 1).
//
// Presentational on purpose: the page resolves the collection, this renders
// it. Keeping it free of data loading is what lets a render test hold both
// themes and every locale up to the light without a database.

export interface CollectionGridProduct {
  productId: string;
  name: string;
  slug: string;
  subtitle: string | null;
  brand: string | null;
}

export interface CollectionGridLabels {
  /** Shown when the collection resolves but holds nothing visible. */
  empty: string;
  previous: string;
  next: string;
  /** Pre-interpolated "Page {page} of {pages}", from the caller's catalog. */
  page: string;
  /** Static aria label for the pagination nav. */
  pagination: string;
}

/**
 * One page of a collection's products, plus crawlable pagination links.
 *
 * Links are anchors, not buttons: the next page is a URL a crawler can
 * follow and a visitor can open in a new tab, which is the whole point of
 * paginating a storefront rather than infinite-scrolling it. Only the chrome
 * here is translated — titles and subtitles are the owner's own words.
 */
export function CollectionGrid({
  products,
  page,
  pageCount,
  labels,
  productHref,
  pageHref,
}: {
  products: CollectionGridProduct[];
  page: number;
  pageCount: number;
  labels: CollectionGridLabels;
  productHref: (product: CollectionGridProduct) => string;
  /**
   * The address of another page of this view. Defaults to the bare
   * `?page=n` a plain collection uses; faceted browses pass one that keeps
   * the applied filters, so page two of "size M" is itself a URL.
   */
  pageHref?: (page: number) => string;
}) {
  const hrefFor = pageHref ?? ((target: number) => `?page=${target}`);
  return (
    <div className="grid gap-6">
      {products.length === 0 ? (
        <p className="text-ink-muted">{labels.empty}</p>
      ) : (
        <ul className="grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <li key={product.productId} className="rounded-lg border border-rule bg-surface p-4">
              <a
                href={productHref(product)}
                className="grid gap-1 font-semibold text-ink hover:text-accent"
              >
                {product.name}
                {product.subtitle ? (
                  <span className="text-sm font-normal text-ink-muted">{product.subtitle}</span>
                ) : null}
                {product.brand ? (
                  <span className="text-xs font-normal text-ink-muted">{product.brand}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <nav className="flex items-center gap-3 text-sm" aria-label={labels.pagination}>
          {page > 1 ? (
            <a
              className="rounded-md border border-rule px-3 py-1.5 text-ink"
              href={hrefFor(page - 1)}
              rel="prev"
            >
              {labels.previous}
            </a>
          ) : null}
          <span className="text-ink-muted">{labels.page}</span>
          {page < pageCount ? (
            <a
              className="rounded-md border border-rule px-3 py-1.5 text-ink"
              href={hrefFor(page + 1)}
              rel="next"
            >
              {labels.next}
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
