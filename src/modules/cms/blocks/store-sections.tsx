// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Store sections (C2.25 slice C): page-level composition with live catalog
// data behind it.
//
// Three blocks — the collection showcase, the picked-product row and the
// promotional band — resolve their content through the same public catalog
// projections the storefront's own shelf pages quote from (browseProducts,
// resolveVisibleProduct, purchaseOptions), and draw their shelves through the
// same presentational components the storefront ships (CollectionGrid,
// AddToCart). A collection added to today shows on the published page today:
// the section holds a *source*, not a copy.
//
// The sections also carry the layout choice the image and video blocks
// established (`width`), with `full` breaking out of the page's text measure
// to a true full-bleed band — the promo band defaults to it, because a band
// that stops at the paragraph column is not a band.

import type { CSSProperties, ReactNode } from "react";
import { z } from "zod";
import { formatMoney, type Translate } from "@/core/i18n";
import type { Actor } from "@/core/service";
import { cx } from "@/ui/primitives";
import { defineBlock } from "./types";
import { fromPlainString, richBodySchema } from "./rich";
import { renderRichDoc } from "./rich-render";
import {
  CollectionGrid,
  type CollectionGridProduct,
} from "../../../../app/(public)/c/[slug]/CollectionGrid";
import { addToCartLabels, type AddToCartProduct } from "../../../../app/(public)/buy/AddToCart";

/** True full-bleed: the classic centred-container breakout, in logical
 * properties so an RTL page bleeds exactly as an LTR one. */
const BLEED: CSSProperties = {
  inlineSize: "100vw",
  marginInline: "calc(50% - 50vw)",
};

function SectionFrame({
  width,
  tone,
  className,
  children,
}: {
  width: "contained" | "full";
  tone?: "plain" | "surface" | "accent" | "ink";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={width === "full" ? BLEED : undefined}
      className={cx(
        width === "full" && "bg-clip-padding",
        tone === "surface" && "border-y border-rule bg-surface",
        tone === "accent" && "bg-accent text-on-accent",
        tone === "ink" && "bg-ink text-paper",
        className,
      )}
    >
      <div
        className={cx(
          "grid gap-6",
          width === "full"
            ? "mx-auto w-full max-w-[80rem] px-[var(--fh-gutter,1.5rem)] py-12"
            : "py-2",
        )}
      >
        {children}
      </div>
    </div>
  );
}

const SECTION_WIDTH = z.enum(["contained", "full"]).default("contained");

async function purchasesFor(
  slugs: string[],
  actor: Actor,
): Promise<{ purchases: Record<string, AddToCartProduct>; currency: string | null }> {
  const { purchaseOptions } = await import("@/modules/catalog/service");
  const entries = slugs.length
    ? await purchaseOptions.call({ slugs }, actor)
    : [];
  return {
    purchases: Object.fromEntries(entries.map((entry) => [entry.slug, entry])),
    currency: entries.find((entry) => entry.currency)?.currency ?? null,
  };
}

function shelfLabels(t: Translate) {
  return {
    empty: t("store.collection.empty"),
    previous: t("store.collection.previous"),
    next: t("store.collection.next"),
    page: t("store.collection.page", { page: 1, pages: 1 }),
    pagination: t("store.collection.pagination"),
  };
}

/**
 * A collection's shelf, composed onto any page (C2.25 slice C).
 *
 * The block names a collection by slug; render time asks the public browse
 * projection for the current membership, so the showcase never shows a stale
 * roster. Cards are shoppable through the same AddToCart the collection page
 * ships, quoting the same purchaseOptions projection.
 */
export const collectionShowcase = defineBlock({
  type: "collectionShowcase",
  labelKey: "cms.block.collectionShowcase",
  contexts: ["page"],
  schema: z.object({
    heading: z.string().trim().max(120).optional(),
    collectionSlug: z.string().trim().toLowerCase().max(180).optional(),
    width: SECTION_WIDTH,
    limit: z.union([z.literal(4), z.literal(8), z.literal(12)]).default(4),
    showPrices: z.boolean().default(true),
  }),
  starter: () => ({ limit: 4 as const, showPrices: true }),
  resolve: async (props, ctx) => {
    if (!props.collectionSlug) return null;
    const { browseProducts } = await import("@/modules/catalog/service");
    const shelf = await browseProducts.call(
      {
        collectionSlug: props.collectionSlug,
        sort: "featured",
        limit: props.limit,
      },
      { kind: "anonymous" },
    );
    if (!shelf.collection) return null;
    const { purchases, currency } = props.showPrices
      ? await purchasesFor(
          shelf.products.map((product) => product.slug),
          ctx.actor ?? { kind: "anonymous" },
        )
      : { purchases: {}, currency: null };
    return { shelf, purchases, currency };
  },
  render: ({ props, resolved, ctx }) => {
    const heading = props.heading ? (
      <h2
        {...ctx.editable?.("heading")}
        className="text-2xl font-bold tracking-tight text-balance"
      >
        {props.heading}
      </h2>
    ) : null;
    const shelf =
      resolved && resolved.shelf.products.length > 0 ? (
        <CollectionGrid
          products={resolved.shelf.products}
          page={1}
          pageCount={1}
          labels={shelfLabels(ctx.t)}
          productHref={(product) =>
            ctx.localizeHref?.(`/products/${product.slug}`) ?? `/products/${product.slug}`
          }
          purchases={resolved.purchases}
          formatMinor={(minor) => formatMoney(minor, resolved.currency ?? "USD", ctx.locale)}
          buyLabels={addToCartLabels(ctx.t)}
        />
      ) : null;
    if (!ctx.identifyBlocks) {
      if (!resolved) return null;
      return (
        <SectionFrame width={props.width}>
          {heading}
          {shelf ?? <p className="text-ink-muted">{ctx.t("store.collection.empty")}</p>}
        </SectionFrame>
      );
    }
    // The canvas: the heading types where it renders, and a replace
    // affordance names the collection the shelf reads from — the editor
    // anchors its picker to it exactly as the image block's picker anchors.
    return (
      <div
        className="fh-store"
        data-store-kind="collection"
        data-store-prop="collectionSlug"
        data-store-current={props.collectionSlug ?? ""}
      >
        <button type="button" className="fh-replace" data-replace-collection="collectionSlug">
          {props.collectionSlug
            ? ctx.t("cms.editor.swapCollection")
            : ctx.t("cms.editor.chooseCollection")}
        </button>
        <SectionFrame width={props.width}>
          {heading}
          {shelf ?? (
            <p className="fh-store-empty">
              {resolved
                ? ctx.t("store.collection.empty")
                : ctx.t("cms.editor.noCollectionChosen")}
            </p>
          )}
        </SectionFrame>
      </div>
    );
  },
});

/**
 * A row of owner-picked products, in the owner's order (C2.25 slice C).
 *
 * The audit's finding 10 named the gap: store blocks were "form-bound and one
 * was UUID-pasting". Here the pick happens on the canvas against the live
 * product list — thumbnails of name and subtitle, multi-select — and the
 * block stores slugs, so membership and order survive the block's own
 * re-renders.
 */
export const productRow = defineBlock({
  type: "productRow",
  labelKey: "cms.block.productRow",
  contexts: ["page"],
  schema: z.object({
    heading: z.string().trim().max(120).optional(),
    products: z
      .array(z.object({ slug: z.string().trim().toLowerCase().min(1).max(180) }))
      .max(12)
      .default([]),
    width: SECTION_WIDTH,
    showPrices: z.boolean().default(true),
  }),
  starter: () => ({ products: [], showPrices: true }),
  resolve: async (props, ctx) => {
    const slugs = [...new Set(props.products.map((entry) => entry.slug))].slice(0, 12);
    if (slugs.length === 0) return null;
    const { resolveVisibleProduct } = await import("@/modules/catalog/service");
    const actor = ctx.actor ?? { kind: "anonymous" as const };
    const found = await Promise.all(
      slugs.map((slug) =>
        resolveVisibleProduct
          .call({ slug }, actor)
          .then((product) => (product ? { ...product, picked: slug } : null))
          .catch(() => null),
      ),
    );
    // Keep the owner's order; drop slugs that do not resolve (drafts,
    // member-only, gone).
    const ordered: Array<NonNullable<(typeof found)[number]>> = [];
    for (const slug of slugs) {
      const hit = found.find((product) => product !== null && product.picked === slug);
      if (hit) ordered.push(hit);
    }
    if (ordered.length === 0) return null;
    const { purchases, currency } = props.showPrices
      ? await purchasesFor(ordered.map((product) => product.slug), actor)
      : { purchases: {}, currency: null };
    return { products: ordered, purchases, currency };
  },
  render: ({ props, resolved, ctx }) => {
    const heading = props.heading ? (
      <h2
        {...ctx.editable?.("heading")}
        className="text-2xl font-bold tracking-tight text-balance"
      >
        {props.heading}
      </h2>
    ) : null;
    const shelf =
      resolved && resolved.products.length > 0 ? (
        <CollectionGrid
          products={
            resolved.products.map((product) => ({
              productId: product.id,
              name: product.name,
              slug: product.slug,
              subtitle: product.subtitle,
              brand: product.brand,
            })) satisfies CollectionGridProduct[]
          }
          page={1}
          pageCount={1}
          labels={shelfLabels(ctx.t)}
          productHref={(product) =>
            ctx.localizeHref?.(`/products/${product.slug}`) ?? `/products/${product.slug}`
          }
          purchases={resolved.purchases}
          formatMinor={(minor) => formatMoney(minor, resolved.currency ?? "USD", ctx.locale)}
          buyLabels={addToCartLabels(ctx.t)}
        />
      ) : null;
    if (!ctx.identifyBlocks) {
      if (!resolved) return null;
      return (
        <SectionFrame width={props.width}>
          {heading}
          {shelf}
        </SectionFrame>
      );
    }
    return (
      <div
        className="fh-store"
        data-store-kind="products"
        data-store-prop="products"
        data-store-current={props.products.map((entry) => entry.slug).join(",")}
      >
        <button type="button" className="fh-replace" data-pick-products="products">
          {resolved
            ? ctx.t("cms.editor.changeProducts")
            : ctx.t("cms.editor.chooseProducts")}
        </button>
        <SectionFrame width={props.width}>
          {heading}
          {shelf ?? <p className="fh-store-empty">{ctx.t("cms.editor.noProductsChosen")}</p>}
        </SectionFrame>
      </div>
    );
  },
});

/**
 * The promotional band (C2.25 slice C): heading, rich copy, a call to action
 * and an optional live shelf — a band that names a collection pulls its
 * current membership at render time and links the shopper straight to the
 * collection's own address.
 */
export const promoBand = defineBlock({
  type: "promoBand",
  labelKey: "cms.block.promoBand",
  contexts: ["page"],
  schema: z.object({
    heading: z.string().trim().max(120).optional(),
    body: richBodySchema.optional(),
    ctaLabel: z.string().trim().max(80).optional(),
    ctaHref: z.string().trim().max(300).optional(),
    tone: z.enum(["surface", "accent", "ink"]).default("surface"),
    width: z.enum(["contained", "full"]).default("full"),
    collectionSlug: z.string().trim().toLowerCase().max(180).optional(),
    limit: z.union([z.literal(0), z.literal(4), z.literal(8)]).default(4),
    showPrices: z.boolean().default(true),
  }),
  starter: () => ({
    heading: "Something worth stopping for",
    body: fromPlainString("Say the thing this band exists to say."),
    ctaLabel: "Shop the collection",
    tone: "surface" as const,
    width: "full" as const,
    limit: 4 as const,
    showPrices: true,
  }),
  resolve: async (props, ctx) => {
    if (!props.collectionSlug || props.limit === 0) return null;
    const { browseProducts } = await import("@/modules/catalog/service");
    const shelf = await browseProducts.call(
      { collectionSlug: props.collectionSlug, sort: "featured", limit: props.limit },
      { kind: "anonymous" },
    );
    if (!shelf.collection) return null;
    const { purchases, currency } = props.showPrices
      ? await purchasesFor(
          shelf.products.map((product) => product.slug),
          ctx.actor ?? { kind: "anonymous" },
        )
      : { purchases: {}, currency: null };
    return { shelf, purchases, currency };
  },
  render: ({ props, resolved, ctx }) => {
    const onAccent = props.tone === "accent" || props.tone === "ink";
    const cta = props.ctaLabel ? (
      <a
        href={
          ctx.localizeHref?.(props.ctaHref ?? "#") ??
          props.ctaHref ??
          "#"
        }
        {...ctx.editable?.("ctaLabel")}
        className={cx(
          "inline-flex w-fit items-center rounded-md px-4 py-2 text-sm font-semibold",
          onAccent
            ? "bg-paper text-ink"
            : "bg-accent text-on-accent shadow-press",
        )}
      >
        {props.ctaLabel}
      </a>
    ) : null;
    const shelf =
      resolved && resolved.shelf.products.length > 0 ? (
        <CollectionGrid
          products={resolved.shelf.products}
          page={1}
          pageCount={1}
          labels={shelfLabels(ctx.t)}
          productHref={(product) =>
            ctx.localizeHref?.(`/products/${product.slug}`) ?? `/products/${product.slug}`
          }
          purchases={resolved.purchases}
          formatMinor={(minor) => formatMoney(minor, resolved.currency ?? "USD", ctx.locale)}
          buyLabels={addToCartLabels(ctx.t)}
        />
      ) : null;
    const inner = (
      <>
        {props.heading ? (
          <h2
            {...ctx.editable?.("heading")}
            className="text-3xl font-bold tracking-tight text-balance"
          >
            {props.heading}
          </h2>
        ) : null}
        {props.body && props.body.length > 0 ? (
          <div
            {...ctx.editableRich?.("body")}
            className={cx(
              "grid max-w-prose gap-3",
              onAccent ? "text-inherit opacity-90" : "text-ink-muted",
            )}
          >
            {renderRichDoc(props.body)}
          </div>
        ) : null}
        {cta}
        {shelf}
        {resolved?.shelf.collection && !props.ctaHref ? (
          <a
            href={
              ctx.localizeHref?.(`/c/${resolved.shelf.collection.slug}`) ??
              `/c/${resolved.shelf.collection.slug}`
            }
            className={cx(
              "text-sm font-semibold",
              onAccent ? "text-inherit underline" : "text-accent",
            )}
          >
            {ctx.t("cms.storeSection.visitCollection", {
              title: resolved.shelf.collection.title,
            })}
          </a>
        ) : null}
      </>
    );
    if (!ctx.identifyBlocks) {
      if (!props.heading && (!props.body || props.body.length === 0) && !cta && !shelf)
        return null;
      return (
        <SectionFrame width={props.width} tone={props.tone}>
          {inner}
        </SectionFrame>
      );
    }
    return (
      <div
        className="fh-store"
        data-store-kind="collection"
        data-store-prop="collectionSlug"
        data-store-current={props.collectionSlug ?? ""}
      >
        <button type="button" className="fh-replace" data-replace-collection="collectionSlug">
          {props.collectionSlug
            ? ctx.t("cms.editor.swapCollection")
            : ctx.t("cms.editor.bandCollection")}
        </button>
        <SectionFrame width={props.width} tone={props.tone}>
          {inner}
        </SectionFrame>
      </div>
    );
  },
});
