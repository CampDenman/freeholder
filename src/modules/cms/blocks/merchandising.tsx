// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storefront commerce blocks (MASTER.md C2.24, scheduled by
// deploy/c324-storefront-parity-2026-09-29.md's gaps G1 and G2).
//
// These blocks are the editor half of the storefront-parity work: C3.25
// built the public collection pages, faceted browse and the buy flow, and
// this file lets an owner compose those same capabilities onto any CMS page.
// The render rule is therefore absolute: every product surface here renders
// through the exact components the storefront pages use — CollectionGrid,
// AddToCart, FacetPanel, SortLinks, SearchBox and the browse-params URL
// codec — so the shelf a shopper sees on /c/<slug> or /search and the shelf
// an owner composes on a page can never diverge. No second grid, no second
// card, no second buy button.
//
// Live blocks resolve through the same public services the pages call
// (catalog.browseProducts, catalog.purchaseOptions, catalog.resolveVisibleProduct)
// with the caller's actor, so audience pricing and member-only visibility
// behave exactly as they do on the entity routes.
//
// Two editor-only behaviors live here, both keyed off `identifyBlocks`:
//
//  - PickerHost: the canvas replace affordance, the image block's pattern
//    generalised. The host names its prop with data-pick-prop and the button
//    posts data-replace-pick; the canvas bridge turns that into an editor
//    picker anchored where the block renders. Media assets keep their own
//    data-asset-prop namespace because the bridge repaints those client-side;
//    an entity pick cannot be repainted from a draft, so the post-save frame
//    reload is its reconciliation path, exactly like a heading level.
//  - `inert` on the buy chrome: the canvas must show the shelf exactly as it
//    will render — a buy button that did not work on the design surface would
//    be a lie — but a form that submits inside the preview iframe would rip
//    the frame to /cart. inert keeps the markup honest and the interaction
//    inert; the public page renders the same elements live.
import { z } from "zod";
import type { ReactNode } from "react";
import { cx } from "@/ui/primitives";
import { formatMoney } from "@/core/i18n";
import { siteOrigin } from "@/core/seo/origin";
import { itemListJsonLd, serializeJsonLd } from "@/core/seo/jsonld";
import type { Actor } from "@/core/service";
import { defineBlock, firstQueryValue, type BlockRenderContext } from "./types";
import type * as catalogService from "@/modules/catalog/service";
import {
  CollectionGrid,
  type CollectionGridProduct,
} from "../../../../app/(public)/c/[slug]/CollectionGrid";
import {
  AddToCart,
  addToCartLabels,
  type AddToCartProduct,
} from "../../../../app/(public)/buy/AddToCart";
import { FacetPanel } from "../../../../app/(public)/browse/FacetPanel";
import { SearchBox } from "../../../../app/(public)/browse/SearchBox";
import { SortLinks } from "../../../../app/(public)/browse/SortLinks";
import {
  browseQueryString,
  browseServiceFilters,
  parseBrowseQuery,
  type BrowseQuery,
} from "../../../../app/(public)/browse-params";

const ANONYMOUS = { kind: "anonymous" } as const;

/** What catalog.browseProducts answers — the grid's resolved shelf. */
type BrowseResult = Awaited<ReturnType<typeof catalogService.browseProducts.call>>;

/** A shelf whose collection resolved: the blocks guard null in `resolve`. */
type BrowseShelf = BrowseResult & {
  collection: NonNullable<BrowseResult["collection"]>;
};

/** Format minor units in the resolved purchase currency, the detail block's fallback. */
function formatMinorOf(currency: string | null | undefined, locale: string) {
  return (minor: number) => formatMoney(minor, currency ?? "USD", locale);
}

/**
 * One product bound to a buy affordance: the public identity plus the
 * purchase projection the cart pages quote from. Kept as one resolve so the
 * card and the buy button can never disagree about which product they show.
 */
async function buyableOf(slug: string, actor: Actor | undefined) {
  const { resolveVisibleProduct, purchaseOptions } = await import(
    "@/modules/catalog/service"
  );
  const caller = actor ?? ANONYMOUS;
  const product = await resolveVisibleProduct.call({ slug }, caller);
  if (!product) return null;
  try {
    // The full purchase projection row: AddToCart reads the variants, and the
    // card reads priceFromMinor/currency for its price line.
    const [purchase] = await purchaseOptions.call({ slugs: [slug] }, caller);
    return { product, purchase: purchase ?? null };
  } catch {
    // A buy panel is never the reason a page fails.
    return { product, purchase: null };
  }
}

/**
 * Purchase projections for exactly the products a grid renders, keyed by
 * slug — the same batched quote the collection page builds for its shelf.
 */
async function purchasesFor(
  slugs: string[],
  ctx: BlockRenderContext,
): Promise<Record<string, AddToCartProduct>> {
  const unique = [...new Set(slugs)].slice(0, 24);
  if (unique.length === 0) return {};
  const { purchaseOptions } = await import("@/modules/catalog/service");
  try {
    const rows = await purchaseOptions.call({ slugs: unique }, ctx.actor ?? ANONYMOUS);
    return Object.fromEntries(rows.map((row) => [row.slug, row as AddToCartProduct]));
  } catch {
    return {};
  }
}

/**
 * The preview-only wrapper around a live block: a dashed placeholder when the
 * block is unbound, and the replace affordance that raises the editor's
 * picker. Public renders never see this — `identifyBlocks` is preview-only.
 * The body itself is left live or inert by the caller: an inert wrapper here
 * would steal the caret from typeable hero copy.
 */
function PickerHost({
  prop,
  current,
  empty,
  replace,
  children,
}: {
  /** The prop the picker writes (the field whose control is collection/product). */
  prop: string;
  current: string;
  empty: string;
  replace: string;
  children: ReactNode;
}) {
  return (
    <div className="fh-asset" data-pick-prop={prop} data-pick-current={current}>
      <div className="fh-asset-body">
        {children ?? <span className="fh-asset-empty">{empty}</span>}
      </div>
      <button type="button" className="fh-replace" data-replace-pick={prop}>
        {replace}
      </button>
    </div>
  );
}

/** The labels SortLinks draws from, identical to the collection page's set. */
function sortLabels(ctx: BlockRenderContext) {
  return {
    nav: ctx.t("store.browse.sort"),
    featured: ctx.t("store.browse.sort.featured"),
    priceAsc: ctx.t("store.browse.sort.priceAsc"),
    priceDesc: ctx.t("store.browse.sort.priceDesc"),
    newest: ctx.t("store.browse.sort.newest"),
    title: ctx.t("store.browse.sort.title"),
  };
}

/** The labels FacetPanel draws from, identical to the collection page's set. */
function facetLabels(ctx: BlockRenderContext) {
  return {
    nav: ctx.t("store.browse.filters"),
    heading: ctx.t("store.browse.filters"),
    clearAll: ctx.t("store.browse.clear"),
    price: ctx.t("store.browse.price"),
    priceMin: ctx.t("store.browse.priceMin"),
    priceMax: ctx.t("store.browse.priceMax"),
    priceApply: ctx.t("store.browse.priceApply"),
    availability: ctx.t("store.browse.availability"),
    inStock: ctx.t("store.browse.inStock"),
    outOfStock: ctx.t("store.browse.outOfStock"),
    observedRange: (min: string, max: string, unit: string) =>
      ctx.t("store.browse.range", { min, max, unit }),
  };
}

/** The chrome labels CollectionGrid needs, identical to the collection page's set. */
function gridLabels(ctx: BlockRenderContext, page: number, pageCount: number) {
  return {
    empty: ctx.t("store.collection.empty"),
    previous: ctx.t("store.collection.previous"),
    next: ctx.t("store.collection.next"),
    page: ctx.t("store.collection.page", { page, pages: pageCount }),
    pagination: ctx.t("store.collection.pagination"),
  };
}

function productHref(ctx: BlockRenderContext, slug: string): string {
  const href = `/products/${slug}`;
  return ctx.localizeHref?.(href) ?? href;
}

/**
 * ItemList structured data for the products a block renders — the same
 * helper, fields and order as the /c/<slug> page emits, so a grid composed
 * onto a page is a first-class list to a crawler, not a second shape of one.
 */
function listJsonLd(
  ctx: BlockRenderContext,
  name: string,
  listUrl: string,
  products: CollectionGridProduct[],
) {
  const origin = siteOrigin();
  return itemListJsonLd({
    name,
    url: `${origin}${listUrl}`,
    items: products.map((product) => ({
      name: product.name,
      url: `${origin}${productHref(ctx, product.slug)}`,
    })),
  });
}

/**
 * A browsable product shelf on any page (C2.24, gap G1's editor half).
 *
 * The block inherits the browse machinery whole: filter state lives in the
 * page's query params through the shared codec (crawlable facet anchors,
 * fail-closed parsing), sort and pagination are the collection page's
 * SortLinks and prev/next anchors, and the grid itself is the collection
 * page's CollectionGrid with the page's purchase projections — facets are
 * one boolean away. One block per page is the intended use: like the /c
 * route, its filter params own the page's query string.
 *
 * The collection being browsed may be manually curated or rule-driven
 * (segment membership): both are collections to catalog.browseProducts, so
 * the owner's pick is one slug and the service owns the derivation.
 */
export const productGrid = defineBlock({
  type: "productGrid",
  labelKey: "cms.block.productGrid",
  contexts: ["page"],
  schema: z.object({
    /** The browsed collection's public address; empty renders nothing yet. */
    collectionSlug: z.string().max(180).default(""),
    /** Products per page (purchaseOptions batches at most 24). */
    pageSize: z.number().int().min(1).max(24).default(12),
    /** The browse machinery's facet panel, for filterable shelves. */
    showFacets: z.boolean().default(false),
  }),
  starter: () => ({ collectionSlug: "" }),
  fieldHints: { collectionSlug: { control: "collection" } },
  resolve: async (props, ctx) => {
    if (!props.collectionSlug) return null;
    const { browseProducts } = await import("@/modules/catalog/service");
    const parsed = parseBrowseQuery(ctx.query ?? {});
    const result = await browseProducts.call(
      {
        collectionSlug: props.collectionSlug,
        filters: browseServiceFilters(parsed),
        sort: parsed.sort ?? "featured",
        limit: props.pageSize,
        offset: (parsed.page - 1) * props.pageSize,
      },
      ctx.actor ?? ANONYMOUS,
    );
    if (!result.collection) return null;
    const purchases = await purchasesFor(
      result.products.map((product) => product.slug),
      ctx,
    );
    return { parsed, result: result as BrowseShelf, purchases };
  },
  render: ({ props, resolved, ctx }) => {
    if (ctx.identifyBlocks) {
      const content = resolved ? (
        <div inert>{gridBody({ props, resolved, ctx })}</div>
      ) : null;
      return (
        <PickerHost
          prop="collectionSlug"
          current={props.collectionSlug}
          empty={ctx.t("cms.editor.noCollection")}
          replace={ctx.t("cms.editor.replaceCollection")}
        >
          {content}
        </PickerHost>
      );
    }
    if (!resolved) return null;
    return (
      <>
        <script
          type="application/ld+json"
          nonce={ctx.cspNonce}
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              listJsonLd(
                ctx,
                resolved.result.collection.title,
                ctx.path,
                resolved.result.products,
              ),
            ),
          }}
        />
        {gridBody({ props, resolved, ctx })}
      </>
    );
  },
});

function gridBody({
  props,
  resolved,
  ctx,
}: {
  props: { showFacets: boolean; pageSize: number };
  resolved: {
    parsed: BrowseQuery;
    result: BrowseShelf;
    purchases: Record<string, AddToCartProduct>;
  };
  ctx: BlockRenderContext;
}) {
  const { parsed, result, purchases } = resolved;
  const { collection, products, total, facets, currency } = result;
  const pageCount = Math.max(1, Math.ceil(total / props.pageSize));
  const hrefFor = (browseQuery: BrowseQuery) => {
    const params = browseQueryString(browseQuery);
    return params ? `${ctx.path}?${params}` : ctx.path;
  };
  const formatMinor = formatMinorOf(currency, ctx.locale);
  return (
    <section className="grid gap-4" aria-label={collection.title}>
      <SortLinks query={parsed} hrefFor={hrefFor} labels={sortLabels(ctx)} />
      <div
        className={cx(
          "grid items-start gap-6",
          props.showFacets && "lg:grid-cols-[16rem_1fr]",
        )}
      >
        {props.showFacets ? (
          <FacetPanel
            facets={facets}
            query={parsed}
            hrefFor={hrefFor}
            formatMinor={formatMinor}
            labels={facetLabels(ctx)}
          />
        ) : null}
        <CollectionGrid
          products={products}
          page={parsed.page}
          pageCount={pageCount}
          labels={gridLabels(ctx, parsed.page, pageCount)}
          productHref={(product) => productHref(ctx, product.slug)}
          pageHref={(target) => hrefFor({ ...parsed, page: target })}
          purchases={purchases}
          formatMinor={formatMinor}
          buyLabels={addToCartLabels(ctx.t)}
        />
      </div>
    </section>
  );
}

/**
 * A collection's hero and its curated front (C2.24; C3.26's merchandising
 * block). The hero reads the collection itself — title and description are
 * the entity's own words, so they update the moment the collection does —
 * under an editable eyebrow and intro the owner writes for this page. The
 * curated products are the collection's first entries in its own order,
 * rendered as the collection page's grid with the same buy affordance, and
 * the block links the collection's own address for the full shelf.
 */
export const featuredCollection = defineBlock({
  type: "featuredCollection",
  labelKey: "cms.block.featuredCollection",
  contexts: ["page"],
  schema: z.object({
    collectionSlug: z.string().max(180).default(""),
    /** Small uppercase line over the title; the owner's words for this page. */
    eyebrow: z.string().max(120).default(""),
    /** A paragraph under the collection's own description. */
    intro: z.string().max(600).default(""),
    /** How many of the collection's products the front shows (max 8). */
    limit: z.number().int().min(1).max(8).default(4),
    /** Link the collection's own /c/<slug> page for the full shelf. */
    showViewAll: z.boolean().default(true),
  }),
  starter: () => ({ collectionSlug: "" }),
  fieldHints: { collectionSlug: { control: "collection" } },
  resolve: async (props, ctx) => {
    if (!props.collectionSlug) return null;
    const { browseProducts } = await import("@/modules/catalog/service");
    const result = await browseProducts.call(
      {
        collectionSlug: props.collectionSlug,
        sort: "featured",
        limit: props.limit,
        offset: 0,
      },
      ctx.actor ?? ANONYMOUS,
    );
    if (!result.collection) return null;
    const purchases = await purchasesFor(
      result.products.map((product) => product.slug),
      ctx,
    );
    return { result: result as BrowseShelf, purchases };
  },
  render: ({ props, resolved, ctx }) => {
    if (ctx.identifyBlocks) {
      const content = resolved ? (
        <div>
          {featuredHeader({ props, resolved, ctx })}
          <div inert>
            <FeaturedShelf resolved={resolved} ctx={ctx} />
          </div>
        </div>
      ) : null;
      return (
        <PickerHost
          prop="collectionSlug"
          current={props.collectionSlug}
          empty={ctx.t("cms.editor.noCollection")}
          replace={ctx.t("cms.editor.replaceCollection")}
        >
          {content}
        </PickerHost>
      );
    }
    if (!resolved) return null;
    const { collection } = resolved.result;
    const collectionHref = ctx.localizeHref?.(`/c/${collection.slug}`) ?? `/c/${collection.slug}`;
    return (
      <>
        <script
          type="application/ld+json"
          nonce={ctx.cspNonce}
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              listJsonLd(ctx, collection.title, collectionHref, resolved.result.products),
            ),
          }}
        />
        <section className="grid gap-6" aria-label={collection.title}>
          {featuredHeader({ props, resolved, ctx })}
          <FeaturedShelf resolved={resolved} ctx={ctx} />
        </section>
      </>
    );
  },
});

function featuredHeader({
  props,
  resolved,
  ctx,
}: {
  props: { eyebrow: string; intro: string; showViewAll: boolean };
  resolved: { result: BrowseShelf };
  ctx: BlockRenderContext;
}) {
  const { collection } = resolved.result;
  return (
    <header className="grid gap-2">
      {props.eyebrow ? (
        <p
          {...ctx.editable?.("eyebrow")}
          className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-accent"
        >
          {props.eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-bold tracking-tight text-balance text-ink">
        {collection.title}
      </h2>
      {collection.description ? (
        <p className="max-w-prose text-ink-muted">{collection.description}</p>
      ) : null}
      {props.intro ? (
        <p {...ctx.editable?.("intro")} className="max-w-prose text-ink-muted">
          {props.intro}
        </p>
      ) : null}
      {props.showViewAll ? (
        <a
          href={ctx.localizeHref?.(`/c/${collection.slug}`) ?? `/c/${collection.slug}`}
          className="w-fit text-sm font-semibold text-accent underline-offset-2 hover:underline"
        >
          {ctx.t("store.featured.viewAll")}
        </a>
      ) : null}
    </header>
  );
}

function FeaturedShelf({
  resolved,
  ctx,
}: {
  resolved: {
    result: BrowseShelf;
    purchases: Record<string, AddToCartProduct>;
  };
  ctx: BlockRenderContext;
}) {
  const { result, purchases } = resolved;
  const formatMinor = formatMinorOf(result.currency, ctx.locale);
  return (
    <CollectionGrid
      products={result.products}
      page={1}
      pageCount={1}
      labels={gridLabels(ctx, 1, 1)}
      productHref={(product) => productHref(ctx, product.slug)}
      purchases={purchases}
      formatMinor={formatMinor}
      buyLabels={addToCartLabels(ctx.t)}
    />
  );
}

/**
 * One product's buy flow, embedded anywhere (C2.24, gap G2's editor half).
 *
 * The block is the shelf's add-to-cart — the same purchase projection and
 * the same AddToCart component the collection page's cards render, so a
 * direct single-variant product gets its add button and an options product
 * gets its variant picker, with no divergent code path. The product name
 * links the product's own page, which carries the full detail block.
 */
export const buyButton = defineBlock({
  type: "buyButton",
  labelKey: "cms.block.buyButton",
  contexts: ["page"],
  schema: z.object({
    productSlug: z.string().min(1).max(180),
  }),
  starter: () => ({ productSlug: "product" }),
  fieldHints: { productSlug: { control: "product" } },
  resolve: async (props, ctx) => buyableOf(props.productSlug, ctx.actor),
  render: ({ props, resolved, ctx }) => {
    if (ctx.identifyBlocks) {
      return (
        <PickerHost
          prop="productSlug"
          current={props.productSlug}
          empty={ctx.t("cms.editor.noProduct")}
          replace={ctx.t("cms.editor.replaceProduct")}
        >
          {resolved ? (
            <div inert>
              <BuyCard resolved={resolved} ctx={ctx} />
            </div>
          ) : null}
        </PickerHost>
      );
    }
    if (!resolved) return null;
    return <BuyCard resolved={resolved} ctx={ctx} />;
  },
});

function BuyCard({
  resolved,
  ctx,
}: {
  resolved: NonNullable<Awaited<ReturnType<typeof buyableOf>>>;
  ctx: BlockRenderContext;
}) {
  const { product, purchase } = resolved;
  const formatMinor = formatMinorOf(purchase?.currency, ctx.locale);
  return (
    <article className="grid w-fit gap-3 rounded-lg border border-rule bg-surface p-4">
      <h2 className="text-lg font-bold tracking-tight text-ink">
        <a href={productHref(ctx, product.slug)} className="hover:text-accent">
          {product.name}
        </a>
      </h2>
      {product.subtitle ? <p className="text-sm text-ink-muted">{product.subtitle}</p> : null}
      {purchase && purchase.variants.length > 0 ? (
        <AddToCart product={purchase} formatMinor={formatMinor} labels={addToCartLabels(ctx.t)} />
      ) : null}
    </article>
  );
}

export { buyableOf };

/**
 * Storefront search on any page (C2.24's search half): the /search page's
 * exact composition — SearchBox, result count, FacetPanel, SortLinks and the
 * shoppable CollectionGrid — scoped by the page's own ?q, with filters and
 * sort riding the same query grammar and every link carrying the term along.
 * Search is a utility everywhere (the /search page is noindexed by the SEO
 * doctrine), so the block emits no JSON-LD; the indexable shelf stays with
 * the collections and product pages it links to.
 */
export const storeSearch = defineBlock({
  type: "storeSearch",
  labelKey: "cms.block.storeSearch",
  contexts: ["page"],
  schema: z.object({
    pageSize: z.number().int().min(1).max(24).default(12),
    showFacets: z.boolean().default(true),
  }),
  starter: () => ({}),
  resolve: async (props, ctx) => {
    const { browseProducts } = await import("@/modules/catalog/service");
    const parsed = parseBrowseQuery(ctx.query ?? {});
    const term = (firstQueryValue(ctx.query?.q) ?? "").trim().slice(0, 120);
    const result = await browseProducts.call(
      {
        term: term || undefined,
        filters: browseServiceFilters(parsed),
        sort: parsed.sort ?? "featured",
        limit: props.pageSize,
        offset: (parsed.page - 1) * props.pageSize,
      },
      ctx.actor ?? ANONYMOUS,
    );
    const purchases = await purchasesFor(
      result.products.map((product) => product.slug),
      ctx,
    );
    return { parsed, term, result, purchases };
  },
  render: ({ props, resolved, ctx }) => {
    const body = searchBody({ props, resolved, ctx });
    if (!ctx.identifyBlocks) return body;
    // Nothing on this block is typeable or pickable; the inert shell shows
    // the preview exactly what ships without forms that could submit.
    return <div inert>{body}</div>;
  },
});

function searchBody({
  props,
  resolved,
  ctx,
}: {
  props: { pageSize: number; showFacets: boolean };
  resolved: {
    parsed: BrowseQuery;
    term: string;
    result: BrowseResult;
    purchases: Record<string, AddToCartProduct>;
  };
  ctx: BlockRenderContext;
}) {
  const { parsed, term, result, purchases } = resolved;
  const { products, total, facets, currency } = result;
  const pageCount = Math.max(1, Math.ceil(total / props.pageSize));
  const termParam = term ? `q=${encodeURIComponent(term)}` : "";
  const hrefFor = (browseQuery: BrowseQuery) => {
    const params = [termParam, browseQueryString(browseQuery)].filter(Boolean).join("&");
    return params ? `${ctx.path}?${params}` : ctx.path;
  };
  const formatMinor = formatMinorOf(currency, ctx.locale);
  return (
    <section className="grid gap-6" aria-label={ctx.t("store.search.heading")}>
      <header className="grid gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-balance text-ink">
          {ctx.t("store.search.heading")}
        </h2>
        <SearchBox
          action={ctx.path}
          term={term}
          labels={{
            aria: ctx.t("store.search.title"),
            placeholder: ctx.t("store.search.placeholder"),
            submit: ctx.t("store.search.submit"),
          }}
        />
        {term ? (
          <p className="text-ink-muted">
            {ctx.t("store.search.resultsFor", { count: total, query: term })}
          </p>
        ) : (
          <p className="text-ink-muted">{ctx.t("store.search.prompt")}</p>
        )}
      </header>
      <div
        className={cx(
          "grid items-start gap-6",
          props.showFacets && "lg:grid-cols-[16rem_1fr]",
        )}
      >
        {props.showFacets ? (
          <FacetPanel
            facets={facets}
            query={parsed}
            hrefFor={hrefFor}
            formatMinor={formatMinor}
            labels={facetLabels(ctx)}
          />
        ) : null}
        <div className="grid gap-4">
          <SortLinks query={parsed} hrefFor={hrefFor} labels={sortLabels(ctx)} />
          <CollectionGrid
            products={products}
            page={parsed.page}
            pageCount={pageCount}
            labels={{
              empty: term ? ctx.t("store.search.empty") : ctx.t("store.search.prompt"),
              previous: ctx.t("store.collection.previous"),
              next: ctx.t("store.collection.next"),
              page: ctx.t("store.collection.page", { page: parsed.page, pages: pageCount }),
              pagination: ctx.t("store.collection.pagination"),
            }}
            productHref={(product) => productHref(ctx, product.slug)}
            pageHref={(target) => hrefFor({ ...parsed, page: target })}
            purchases={purchases}
            formatMinor={formatMinor}
            buyLabels={addToCartLabels(ctx.t)}
          />
        </div>
      </div>
    </section>
  );
}
