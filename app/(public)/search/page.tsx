// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public storefront search page (C3.25 slice 2, gap G1 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// The shopper-facing half of findability, distinct from the owner-facing
// global search: the same catalog.browseProducts query the collection page
// renders, scoped by the term in ?q and shaped by the same filter/sort URL
// grammar. Products already participate in the global search registry; this
// page is where a visitor actually searches them.
//
// SEO: internal search results are a utility surface, not landing pages —
// the page is noindexed,follow at every address (term or not) and
// canonicalises to the bare /search, per the same doctrine that noindexes
// filter-shaped queries (src/core/seo/meta.ts). The browsable, indexable
// shelf lives at the products index and the collections; search is how a
// shopper moves inside it.

import type { Metadata } from "next";
import { browseProducts, purchaseOptions } from "@/modules/catalog/service";
import { composeDocumentTitle, ogImagePath } from "@/core/seo/meta";
import { siteOrigin } from "@/core/seo/origin";
import { localePath, localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import { getLocale, getT } from "../../i18n";
import { recordPageView } from "../[[...slug]]/pageview";
import { CollectionGrid, type CollectionGridProduct } from "../c/[slug]/CollectionGrid";
import { addToCartLabels } from "../buy/AddToCart";
import { FacetPanel, type FacetPanelData } from "../browse/FacetPanel";
import { SearchBox } from "../browse/SearchBox";
import { SortLinks } from "../browse/SortLinks";
import {
  browseQueryString,
  browseServiceFilters,
  parseBrowseQuery,
  type BrowseQuery,
} from "../browse-params";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;
const PAGE_SIZE = 24;

type Query = Record<string, string | string[] | undefined>;

function termOf(query: Query): string | undefined {
  const raw = query.q;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const term = value?.trim();
  return term ? term.slice(0, 120) : undefined;
}

async function search(query: Query) {
  const parsed = parseBrowseQuery(query);
  const term = termOf(query);
  const result = await browseProducts.call(
    {
      term,
      filters: browseServiceFilters(parsed),
      sort: parsed.sort ?? "featured",
      limit: PAGE_SIZE,
      offset: (parsed.page - 1) * PAGE_SIZE,
    },
    ANONYMOUS,
  );
  return { parsed, term, result };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Query>;
}): Promise<Metadata> {
  const query = await searchParams;
  const term = termOf(query);
  const [business] = await Promise.all([currentBusiness()]);
  const t = await getT();
  const origin = siteOrigin();
  const defaultLocale = business?.defaultLocale ?? "en";
  const siteName = business?.name;
  const title = composeDocumentTitle(
    term ? `${t("store.search.title")}: ${term}` : t("store.search.title"),
    siteName,
    false,
  );
  // One address for every term and filter combination: the utility page
  // itself. results are followable but never indexed.
  const canonical = `${origin}${localePath("search", defaultLocale, defaultLocale)}`;
  return {
    title,
    description: t("store.search.prompt"),
    robots: { index: false, follow: true },
    alternates: { canonical },
    openGraph: {
      title,
      description: t("store.search.prompt"),
      type: "website",
      url: canonical,
      siteName: siteName ?? undefined,
      images: [{ url: `${origin}${ogImagePath("search")}`, width: 1200, height: 630, alt: title }],
    },
  };
}

export default async function StorefrontSearchPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const query = await searchParams;
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const [{ parsed, term, result }, business] = await Promise.all([
    search(query),
    currentBusiness(),
  ]);
  const { products, total, facets, currency } = result;

  await recordPageView("search", locale, query);

  // Slice 3: the results are shoppable through the same batched projection
  // the collection page uses — one call for exactly the page's products.
  const purchases = products.length
    ? Object.fromEntries(
        (
          await purchaseOptions.call(
            { slugs: products.map((product) => product.slug) },
            ANONYMOUS,
          )
        ).map((entry) => [entry.slug, entry]),
      )
    : {};

  const defaultLocale = business?.defaultLocale ?? "en";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const gridProducts: CollectionGridProduct[] = products;
  const searchPath = localePath("search", locale, defaultLocale);

  // Every browse link on this page must carry the term along: a facet on
  // /search?q=print that navigated away from ?q would answer a different
  // question than the shopper asked.
  const termParam = term ? `q=${encodeURIComponent(term)}` : "";
  const hrefFor = (browseQuery: BrowseQuery) => {
    const params = [termParam, browseQueryString(browseQuery)].filter(Boolean).join("&");
    return params ? `${searchPath}?${params}` : searchPath;
  };
  const pageHref = (target: number) => hrefFor({ ...parsed, page: target });
  const formatMinor = (minor: number) =>
    formatMoney(minor, currency ?? business?.baseCurrency ?? "USD", locale);
  const facetData: FacetPanelData = facets;

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {t("store.search.heading")}
        </h1>
        <SearchBox
          action={searchPath}
          term={term ?? ""}
          labels={{
            aria: t("store.search.title"),
            placeholder: t("store.search.placeholder"),
            submit: t("store.search.submit"),
          }}
        />
        {term ? (
          <p className="text-ink-muted">
            {t("store.search.resultsFor", { count: total, query: term })}
          </p>
        ) : (
          <p className="text-ink-muted">{t("store.search.prompt")}</p>
        )}
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
        <FacetPanel
          facets={facetData}
          query={parsed}
          hrefFor={hrefFor}
          formatMinor={formatMinor}
          labels={{
            nav: t("store.browse.filters"),
            heading: t("store.browse.filters"),
            clearAll: t("store.browse.clear"),
            price: t("store.browse.price"),
            priceMin: t("store.browse.priceMin"),
            priceMax: t("store.browse.priceMax"),
            priceApply: t("store.browse.priceApply"),
            availability: t("store.browse.availability"),
            inStock: t("store.browse.inStock"),
            outOfStock: t("store.browse.outOfStock"),
            observedRange: (min, max, unit) => t("store.browse.range", { min, max, unit }),
          }}
        />
        <div className="grid gap-4">
          <SortLinks
            query={parsed}
            hrefFor={hrefFor}
            labels={{
              nav: t("store.browse.sort"),
              featured: t("store.browse.sort.featured"),
              priceAsc: t("store.browse.sort.priceAsc"),
              priceDesc: t("store.browse.sort.priceDesc"),
              newest: t("store.browse.sort.newest"),
              title: t("store.browse.sort.title"),
            }}
          />
          <CollectionGrid
            products={gridProducts}
            page={parsed.page}
            pageCount={pageCount}
            labels={{
              empty: term ? t("store.search.empty") : t("store.search.prompt"),
              previous: t("store.collection.previous"),
              next: t("store.collection.next"),
              page: t("store.collection.page", { page: parsed.page, pages: pageCount }),
              pagination: t("store.collection.pagination"),
            }}
            productHref={(product) =>
              business
                ? localizeCustomerHref(`/products/${product.slug}`, locale, business)
                : `/products/${product.slug}`
            }
            pageHref={pageHref}
            purchases={purchases}
            formatMinor={formatMinor}
            buyLabels={addToCartLabels(t)}
          />
        </div>
      </div>
    </div>
  );
}
