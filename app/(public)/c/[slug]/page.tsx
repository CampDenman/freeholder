// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public collection page (C3.25 slice 1, gap G1 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// Why a route and not a CMS page: the catch-all route renders block trees an
// owner composed, but the collection *grid* is an entity rendering — the
// membership, ordering and pagination come from the catalog services and stay
// current without anyone editing a page. The editor block that lets an owner
// compose a collection onto any page is C2.24; this route is the address the
// taxonomy itself lives at. Same exemption the gift-registry page already
// takes: §32's "structure is data" governs authored pages, not entity views.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolvePublicCollection } from "@/modules/catalog/service";
import {
  breadcrumbJsonLd,
  collectionPageJsonLd,
  itemListJsonLd,
  serializeJsonLd,
} from "@/core/seo/jsonld";
import {
  composeDescription,
  composeDocumentTitle,
  ogImagePath,
} from "@/core/seo/meta";
import { siteOrigin } from "@/core/seo/origin";
import { localePath, localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { CSP_NONCE_HEADER } from "@/core/http/csp";
import { getLocale, getT } from "../../../i18n";
import { recordPageView } from "../../[[...slug]]/pageview";
import { ShareBar } from "../../ShareBar";
import { CollectionGrid, type CollectionGridProduct } from "./CollectionGrid";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;
const PAGE_SIZE = 24;

type Params = { slug: string };
type Query = Record<string, string | string[] | undefined>;

/** One-based page number; anything unparsable is page one, never page zero. */
function pageNumber(query: Query): number {
  const raw = query.page;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function resolve(slug: string, page: number) {
  return resolvePublicCollection.call(
    { slug, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    ANONYMOUS,
  );
}

function seoOf(collection: { seo: unknown }): {
  title?: string;
  description?: string;
} {
  return (collection.seo ?? {});
}

/**
 * The collection's own address in a locale (§4.9's URL strategy: the default
 * locale goes unprefixed, the others carry their tag).
 */
function canonicalFor(
  origin: string,
  slug: string,
  locale: string,
  defaultLocale: string,
): string {
  return `${origin}${localePath(`c/${slug}`, locale, defaultLocale)}`;
}

/**
 * hreflang for a page that genuinely serves every enabled locale: the
 * membership is one set, the chrome translates, so the full reciprocal set
 * is the honest answer, with x-default on the site's own language (§5).
 */
function alternatesFor(
  origin: string,
  slug: string,
  business: { defaultLocale: string; enabledLocales: string[] } | null,
): Record<string, string> | null {
  if (!business || business.enabledLocales.length < 2) return null;
  const languages: Record<string, string> = {};
  for (const locale of business.enabledLocales) {
    languages[locale] = canonicalFor(origin, slug, locale, business.defaultLocale);
  }
  languages["x-default"] = canonicalFor(
    origin,
    slug,
    business.defaultLocale,
    business.defaultLocale,
  );
  return languages;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Query>;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = pageNumber(query);
  const [{ collection }, business] = await Promise.all([
    resolve(slug, page),
    currentBusiness(),
  ]);
  if (!collection) return {};

  const seo = seoOf(collection);
  const origin = siteOrigin();
  const defaultLocale = business?.defaultLocale ?? "en";
  const siteName = business?.name;
  // §5: the stored override wins, the fallback is what the collection knows
  // about itself, and the title is composed the same way every page composes
  // one — a collection is not a second-class citizen of the sitemap.
  const title = composeDocumentTitle(seo.title ?? collection.title, siteName, false);
  const description = composeDescription(
    seo.description ?? collection.description ?? undefined,
  );
  const canonical = canonicalFor(origin, collection.slug, defaultLocale, defaultLocale);
  const alternates = alternatesFor(origin, collection.slug, business);

  // Paginated views are real URLs a visitor can land on, but they are not
  // what a search result should point at — the collection is. They stay
  // followable so a crawler still walks them to the products.
  return {
    title,
    description,
    robots: page > 1 ? { index: false, follow: true } : undefined,
    alternates: { canonical, ...(alternates ? { languages: alternates } : {}) },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: siteName ?? undefined,
      images: [{ url: `${origin}${ogImagePath(`c/${collection.slug}`)}`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}${ogImagePath(`c/${collection.slug}`)}`],
    },
  };
}

export default async function PublicCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Query>;
}) {
  const [{ slug }, query, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;
  const page = pageNumber(query);
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const [{ collection, products, total }, business] = await Promise.all([
    resolve(slug, page),
    currentBusiness(),
  ]);
  // Unpublished, trashed or never-there: one answer, and the honest one.
  if (!collection) notFound();

  await recordPageView(`/c/${collection.slug}`, locale, query);

  const origin = siteOrigin();
  const defaultLocale = business?.defaultLocale ?? "en";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const gridProducts: CollectionGridProduct[] = products;
  const description = seoOf(collection).description ?? collection.description;
  const url = canonicalFor(origin, collection.slug, locale, defaultLocale);

  // §5's structured-data contract: the page says what it is (a CollectionPage
  // carrying an ItemList), where it sits (a breadcrumb one hop under home),
  // and what it holds (every visible product, in the order shown).
  const jsonLd = [
    breadcrumbJsonLd(origin, `c/${collection.slug}`, (segmentPath) =>
      segmentPath === "" ? (business?.name ?? t("home.brand")) : collection.title,
    ),
    collectionPageJsonLd({
      name: collection.title,
      url,
      description,
    }),
    itemListJsonLd({
      name: collection.title,
      url,
      items: gridProducts.map((product) => ({
        name: product.name,
        url: `${origin}${localePath(`products/${product.slug}`, locale, defaultLocale)}`,
      })),
    }),
  ].filter((entry) => entry !== undefined);

  return (
    <>
      {jsonLd.map((entry, index) => (
        <script
          key={index}
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
        />
      ))}
      <div className="grid gap-6">
        <header className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
            {collection.title}
          </h1>
          {collection.description ? (
            <p className="max-w-prose text-ink-muted">{collection.description}</p>
          ) : null}
        </header>
        <CollectionGrid
          products={gridProducts}
          page={page}
          pageCount={pageCount}
          labels={{
            empty: t("store.collection.empty"),
            previous: t("store.collection.previous"),
            next: t("store.collection.next"),
            page: t("store.collection.page", { page, pages: pageCount }),
            pagination: t("store.collection.pagination"),
          }}
          productHref={(product) =>
            business
              ? localizeCustomerHref(`/products/${product.slug}`, locale, business)
              : `/products/${product.slug}`
          }
        />
      </div>
      <ShareBar
        path={`c/${collection.slug}`}
        locale={locale}
        title={collection.title}
        siteName={business?.name ?? null}
        sharedRef={typeof query.shared === "string" ? query.shared : undefined}
      />
    </>
  );
}
